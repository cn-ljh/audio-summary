// Global variables
let currentTaskId = null;
let pollingInterval = null;
let audioPlayerModal = null;

// API 请求辅助函数（带认证）
async function apiRequest(url, options = {}) {
    const token = cognitoAuth.getIdToken();
    
    if (!token) {
        throw new Error('未登录或会话已过期');
    }

    const headers = {
        'Authorization': `Bearer ${token}`,
        ...options.headers
    };

    const response = await fetch(`${API_BASE_URL}${url}`, {
        ...options,
        headers
    });

    // Token 过期，尝试刷新
    if (response.status === 401) {
        try {
            await cognitoAuth.refreshSession();
            // 重试请求
            return await fetch(`${API_BASE_URL}${url}`, {
                ...options,
                headers: {
                    'Authorization': `Bearer ${cognitoAuth.getIdToken()}`,
                    ...options.headers
                }
            });
        } catch (err) {
            // 刷新失败，重新登录
            cognitoAuth.signOut();
            window.location.reload();
            throw new Error('会话已过期，请重新登录');
        }
    }

    return response;
}

// Upload form handler
document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const fileInput = document.getElementById('audioFile');
    const file = fileInput.files[0];

    if (!file) {
        showAlert('请选择音频文件', 'danger');
        return;
    }

    // Soft warning for files >2GB (AWS Transcribe batch limit)
    if (file.size > 2 * 1024 * 1024 * 1024) {
        showAlert(
            `提示：文件大小为 ${(file.size / 1024 / 1024 / 1024).toFixed(1)}GB，超过 AWS Transcribe 2GB 上限，转录可能失败。上传仍将继续。`,
            'warning'
        );
    }

    // Show progress
    document.getElementById('uploadProgress').classList.remove('d-none');
    document.getElementById('uploadBtn').disabled = true;
    document.getElementById('uploadSpinner').classList.remove('d-none');
    document.getElementById('uploadBtnText').textContent = '获取上传地址...';

    try {
        // Step 1: Request presigned URL from backend (no file content sent through API Gateway)
        const response = await apiRequest('/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: file.name,
                file_size: file.size
            })
        });

        const data = await response.json();

        if (!response.ok) {
            showAlert(`上传失败: ${data.error}`, 'danger');
            return;
        }

        currentTaskId = data.task_id;

        // Step 2: Upload directly to S3 via presigned URL with real progress
        document.getElementById('uploadBtnText').textContent = '上传中...';
        await uploadToS3WithProgress(file, data.upload_url);

        showAlert(`文件上传成功！任务 ID: ${data.task_id}`, 'success');

        // Step 3: Start transcription
        document.getElementById('uploadBtnText').textContent = '启动转录...';

        const startResponse = await apiRequest('/start-transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: data.task_id })
        });

        if (startResponse.ok) {
            showAlert('转录任务已启动！', 'success');
        }

        // Show current task section and start polling
        document.getElementById('currentTaskSection').classList.remove('d-none');
        startPolling(data.task_id);

        // Reset form
        fileInput.value = '';
        loadTasks();

    } catch (error) {
        showAlert(`上传错误: ${error.message}`, 'danger');
    } finally {
        document.getElementById('uploadBtn').disabled = false;
        document.getElementById('uploadSpinner').classList.add('d-none');
        document.getElementById('uploadBtnText').textContent = '上传并处理';
        document.getElementById('progressBar').style.width = '0%';
        document.getElementById('progressText').textContent = '';
        document.getElementById('uploadProgress').classList.add('d-none');
    }
});

// Upload file directly to S3 presigned URL with progress reporting
function uploadToS3WithProgress(file, presignedUrl) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                document.getElementById('progressBar').style.width = `${pct}%`;
                const loaded = (e.loaded / 1024 / 1024).toFixed(1);
                const total = (e.total / 1024 / 1024).toFixed(1);
                document.getElementById('progressText').textContent =
                    `上传中 ${loaded}MB / ${total}MB (${pct}%)`;
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            } else {
                reject(new Error(`S3 上传失败，状态码: ${xhr.status}`));
            }
        });

        xhr.addEventListener('error', () => reject(new Error('网络错误，上传失败')));
        xhr.addEventListener('abort', () => reject(new Error('上传已取消')));

        xhr.open('PUT', presignedUrl);
        const ext = file.name.split('.').pop().toLowerCase();
        xhr.setRequestHeader('Content-Type', `audio/${ext}`);
        xhr.send(file);
    });
}

// Start polling for task status
function startPolling(taskId) {
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }
    
    // Poll every 5 seconds
    pollingInterval = setInterval(() => {
        checkTaskStatus(taskId);
    }, 5000);
    
    // Initial check
    checkTaskStatus(taskId);
}

// Check task status
async function checkTaskStatus(taskId) {
    try {
        const response = await apiRequest(`/task/${taskId}`);
        const data = await response.json();
        
        updateCurrentTask(data);
        
        // Stop polling if task is completed or failed
        if (data.status === 'completed' || data.status === 'failed') {
            if (pollingInterval) {
                clearInterval(pollingInterval);
                pollingInterval = null;
            }
            
            // Reload tasks list
            loadTasks();
            
            // Hide progress
            document.getElementById('uploadProgress').classList.add('d-none');
        }
    } catch (error) {
        console.error('检查任务状态失败:', error);
    }
}

// Update current task display
function updateCurrentTask(task) {
    const currentTaskDiv = document.getElementById('currentTask');
    
    let statusBadge = '';
    if (task.status === 'completed') {
        statusBadge = '<span class="badge bg-success">✓ 已完成</span>';
    } else if (task.status === 'failed') {
        statusBadge = '<span class="badge bg-danger">✗ 失败</span>';
    } else if (task.status === 'transcribing') {
        statusBadge = '<span class="badge bg-info">⏳ 转录中...</span>';
    } else if (task.status === 'generating_summary') {
        statusBadge = '<span class="badge bg-info">📝 生成摘要中...</span>';
    } else {
        statusBadge = '<span class="badge bg-warning">⏸ 等待中...</span>';
    }
    
    // Update progress bar
    const progress = getTaskProgress(task.status);
    document.getElementById('progressBar').style.width = `${progress}%`;
    document.getElementById('progressText').textContent = getProgressText(task.status);
    
    const hasAudio = !!(task.s3_key || task.audio_filename);
    const audioBtn = hasAudio
        ? `<button class="btn btn-sm btn-outline-primary ms-2" onclick="openAudioPlayer('${task.task_id}', '${escapeAttr(task.audio_filename || '')}')">
               <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-play-circle me-1" viewBox="0 0 16 16">
                 <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
                 <path d="M6.271 5.055a.5.5 0 0 1 .52.038l3.5 2.5a.5.5 0 0 1 0 .814l-3.5 2.5A.5.5 0 0 1 6 10.5v-5a.5.5 0 0 1 .271-.445"/>
               </svg>播放音频
           </button>`
        : '';

    let html = `
        <div class="card">
            <div class="card-body">
                <h6 class="card-subtitle mb-2 text-muted">
                    任务 ID: ${task.task_id} ${statusBadge}${audioBtn}
                </h6>
                <p class="card-text">
                    <strong>文件名:</strong> ${task.audio_filename}<br>
                    <strong>创建时间:</strong> ${formatDate(task.created_at)}<br>
                    <strong>更新时间:</strong> ${formatDate(task.updated_at)}
                </p>
    `;

    // 内嵌音频播放器占位，加载后注入
    if (hasAudio) {
        html += `<div id="inlineAudioPlayer-${task.task_id}" class="mb-3"></div>`;
    }

    if (task.transcription_text) {
        html += `
                <div class="mt-3">
                    <h6>转录文本:</h6>
                    <div class="border p-3 bg-light" style="max-height: 300px; overflow-y: auto; white-space: pre-wrap;">
${escapeHtml(task.transcription_text)}
                    </div>
                </div>
        `;
    }

    if (task.summary_text) {
        html += `
                <div class="mt-3">
                    <h6>AI 摘要:</h6>
                    <div class="border p-3 bg-light" style="max-height: 300px; overflow-y: auto; white-space: pre-wrap;">
${escapeHtml(task.summary_text)}
                    </div>
                </div>
        `;
    }

    html += `
            </div>
        </div>
    `;

    currentTaskDiv.innerHTML = html;

    // 自动加载内嵌播放器（仅任务完成时）
    if (hasAudio && task.status === 'completed') {
        loadInlineAudioPlayer(task.task_id);
    }
}

// Load tasks list
async function loadTasks() {
    try {
        const response = await apiRequest('/tasks');
        const data = await response.json();
        
        const tasksListDiv = document.getElementById('tasksList');
        
        if (!data.tasks || data.tasks.length === 0) {
            tasksListDiv.innerHTML = '<p class="text-muted">暂无任务记录</p>';
            return;
        }
        
        let html = '<div class="list-group">';
        
        data.tasks.forEach(task => {
            let statusBadge = '';
            let statusClass = '';
            let statusText = '';
            
            switch(task.status) {
                case 'completed':
                    statusClass = 'bg-success';
                    statusText = '✓ 已完成';
                    break;
                case 'failed':
                    statusClass = 'bg-danger';
                    statusText = '✗ 失败';
                    break;
                case 'transcribing':
                    statusClass = 'bg-info';
                    statusText = '⏳ 转录中';
                    break;
                case 'generating_summary':
                    statusClass = 'bg-info';
                    statusText = '📝 生成摘要';
                    break;
                case 'pending_upload':
                    statusClass = 'bg-secondary';
                    statusText = '⏸ 待上传';
                    break;
                case 'pending':
                    statusClass = 'bg-secondary';
                    statusText = '⏸ 等待中';
                    break;
                default:
                    statusClass = 'bg-warning';
                    statusText = '⚙️ 处理中';
            }
            
            statusBadge = `<span class="badge ${statusClass}">${statusText}</span>`;
            
            html += `
                <div class="list-group-item list-group-item-action" onclick="viewTask('${task.task_id}')">
                    <div class="d-flex w-100 justify-content-between">
                        <h6 class="mb-1">${task.audio_filename}</h6>
                        ${statusBadge}
                    </div>
                    <p class="mb-1 text-muted small">
                        创建时间: ${formatDate(task.created_at)}
                    </p>
                </div>
            `;
        });
        
        html += '</div>';
        tasksListDiv.innerHTML = html;
    } catch (error) {
        console.error('加载任务列表失败:', error);
        document.getElementById('tasksList').innerHTML = 
            '<p class="text-danger">加载失败: ' + error.message + '</p>';
    }
}

// View task details
async function viewTask(taskId) {
    try {
        const response = await apiRequest(`/task/${taskId}`);
        const data = await response.json();
        
        document.getElementById('currentTaskSection').classList.remove('d-none');
        updateCurrentTask(data);
        
        // Scroll to current task
        document.getElementById('currentTaskSection').scrollIntoView({ 
            behavior: 'smooth' 
        });
    } catch (error) {
        showAlert('加载任务详情失败: ' + error.message, 'danger');
    }
}

// Helper functions
function showAlert(message, type) {
    const alertDiv = document.getElementById('uploadResult');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.textContent = message;
    alertDiv.classList.remove('d-none');
    
    setTimeout(() => {
        alertDiv.classList.add('d-none');
    }, 5000);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN');
}

function getTaskProgress(status) {
    const progressMap = {
        'pending': 10,
        'transcribing': 50,
        'generating_summary': 80,
        'completed': 100,
        'failed': 100
    };
    return progressMap[status] || 0;
}

function getProgressText(status) {
    const textMap = {
        'pending': '等待处理...',
        'transcribing': '正在转录音频...',
        'generating_summary': '正在生成摘要...',
        'completed': '处理完成！',
        'failed': '处理失败'
    };
    return textMap[status] || '处理中...';
}

// ──────────────────────────────────────────
// 音频播放器相关功能
// ──────────────────────────────────────────

/**
 * 从后端获取 presigned URL 并加载内嵌播放器
 */
async function loadInlineAudioPlayer(taskId) {
    const container = document.getElementById(`inlineAudioPlayer-${taskId}`);
    if (!container) return;

    container.innerHTML = `
        <div class="audio-player-loading d-flex align-items-center text-muted small py-2">
            <span class="spinner-border spinner-border-sm me-2"></span>加载音频播放器...
        </div>`;

    try {
        const response = await apiRequest(`/task/${taskId}/audio-url`);
        const data = await response.json();

        if (!response.ok) {
            container.innerHTML = `<p class="text-danger small">音频加载失败: ${data.error}</p>`;
            return;
        }

        container.innerHTML = buildAudioPlayerHTML(data.url, data.filename || '');
        initAudioPlayerEvents(container);
    } catch (err) {
        container.innerHTML = `<p class="text-danger small">音频加载失败: ${err.message}</p>`;
    }
}

/**
 * 点击"播放音频"按钮时在模态框中打开播放器
 */
async function openAudioPlayer(taskId, filename) {
    const container = document.getElementById('audioPlayerContainer');
    const modalTitle = document.getElementById('audioPlayerModalLabel');
    modalTitle.textContent = `音频播放 — ${filename}`;

    container.innerHTML = `
        <div class="d-flex align-items-center justify-content-center p-4 text-muted">
            <span class="spinner-border spinner-border-sm me-2"></span>加载中...
        </div>`;

    if (!audioPlayerModal) {
        audioPlayerModal = new bootstrap.Modal(document.getElementById('audioPlayerModal'));
    }
    audioPlayerModal.show();

    // 停止模态框关闭时残留播放
    document.getElementById('audioPlayerModal').addEventListener('hidden.bs.modal', () => {
        const audio = container.querySelector('audio');
        if (audio) audio.pause();
    }, { once: true });

    try {
        const response = await apiRequest(`/task/${taskId}/audio-url`);
        const data = await response.json();

        if (!response.ok) {
            container.innerHTML = `<div class="p-3 text-danger">音频加载失败: ${data.error}</div>`;
            return;
        }

        container.innerHTML = buildAudioPlayerHTML(data.url, data.filename || filename);
        initAudioPlayerEvents(container);
    } catch (err) {
        container.innerHTML = `<div class="p-3 text-danger">音频加载失败: ${err.message}</div>`;
    }
}

/**
 * 构建音频播放器 HTML
 */
function buildAudioPlayerHTML(audioUrl, filename) {
    return `
        <div class="audio-player">
            <div class="audio-player-header">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" class="bi bi-music-note-beamed" viewBox="0 0 16 16">
                    <path d="M6 13c0 1.105-1.12 2-2.5 2S1 14.105 1 13s1.12-2 2.5-2 2.5.895 2.5 2m9-2c0 1.105-1.12 2-2.5 2s-2.5-.895-2.5-2 1.12-2 2.5-2 2.5.895 2.5 2"/>
                    <path fill-rule="evenodd" d="M14 11V2h1v9zM6 3v10H5V3z"/>
                    <path d="M5 2.905a1 1 0 0 1 .9-.995l8-.8a1 1 0 0 1 1.1.995V3L5 4z"/>
                </svg>
                <span class="audio-player-filename">${escapeHtml(filename)}</span>
            </div>

            <audio id="audioElement" preload="metadata">
                <source src="${audioUrl}" />
                您的浏览器不支持 HTML5 音频播放。
            </audio>

            <!-- 进度条 -->
            <div class="audio-progress-wrapper">
                <span class="audio-time" id="currentTime">0:00</span>
                <div class="audio-progress-bar-track" id="progressTrack">
                    <div class="audio-progress-bar-fill" id="progressFill"></div>
                    <div class="audio-progress-bar-thumb" id="progressThumb"></div>
                </div>
                <span class="audio-time" id="totalTime">0:00</span>
            </div>

            <!-- 控制按钮行 -->
            <div class="audio-controls">
                <!-- 倒退 10s -->
                <button class="audio-ctrl-btn" id="seekBackBtn" title="倒退 10 秒">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M.5 3.5A.5.5 0 0 1 1 4v3.248l6.267-3.636c.52-.302 1.233.043 1.233.696v2.94l6.267-3.636c.52-.302 1.233.043 1.233.696v7.384c0 .653-.713.998-1.233.696L8.5 8.752v2.94c0 .653-.713.998-1.233.696L1 8.752V12a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5"/>
                    </svg>
                </button>

                <!-- 播放/暂停 -->
                <button class="audio-play-btn" id="playPauseBtn" title="播放/暂停">
                    <svg id="playIcon" xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M10.804 8 5 4.633v6.734zm.792-.696a.802.802 0 0 1 0 1.392l-6.363 3.692C4.713 12.69 4 12.345 4 11.692V4.308c0-.653.713-.998 1.233-.696z"/>
                    </svg>
                    <svg id="pauseIcon" xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="currentColor" viewBox="0 0 16 16" class="d-none">
                        <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/>
                    </svg>
                </button>

                <!-- 快进 10s -->
                <button class="audio-ctrl-btn" id="seekForwardBtn" title="快进 10 秒">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M15.5 3.5a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0V8.752l-6.267 3.636c-.52.302-1.233-.043-1.233-.696v-2.94l-6.267 3.636C.713 12.69 0 12.345 0 11.692V4.308c0-.653.713-.998 1.233-.696L7.5 7.248v-2.94c0-.653.713-.998 1.233-.696L15 7.248V4a.5.5 0 0 1 .5-.5"/>
                    </svg>
                </button>

                <!-- 音量 -->
                <div class="audio-volume-group">
                    <button class="audio-ctrl-btn" id="muteBtn" title="静音">
                        <svg id="volumeIcon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M11.536 14.01A8.47 8.47 0 0 0 14.026 8a8.47 8.47 0 0 0-2.49-6.01l-.708.707A7.48 7.48 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303z"/>
                            <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.48 5.48 0 0 1 11.025 8a5.48 5.48 0 0 1-1.61 3.89z"/>
                            <path d="M8.707 11.182A4.5 4.5 0 0 0 10.025 8a4.5 4.5 0 0 0-1.318-3.182L8 5.525A3.5 3.5 0 0 1 9.025 8 3.5 3.5 0 0 1 8 10.475zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325z"/>
                        </svg>
                        <svg id="muteIcon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" class="d-none">
                            <path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06zm7.137 2.096a.5.5 0 0 1 0 .708L12.207 8l1.647 1.646a.5.5 0 0 1-.708.708L11.5 8.707l-1.646 1.647a.5.5 0 0 1-.708-.708L10.793 8 9.146 6.354a.5.5 0 1 1 .708-.708L11.5 7.293l1.646-1.647a.5.5 0 0 1 .708 0"/>
                        </svg>
                    </button>
                    <input type="range" class="audio-volume-slider" id="volumeSlider" min="0" max="1" step="0.05" value="1">
                </div>

                <!-- 播放速度 -->
                <div class="audio-speed-group">
                    <span class="audio-speed-label">速度</span>
                    <div class="btn-group btn-group-sm" role="group">
                        <button type="button" class="btn btn-outline-secondary audio-speed-btn" data-speed="0.5">0.5x</button>
                        <button type="button" class="btn btn-secondary audio-speed-btn active" data-speed="1">1x</button>
                        <button type="button" class="btn btn-outline-secondary audio-speed-btn" data-speed="1.5">1.5x</button>
                        <button type="button" class="btn btn-outline-secondary audio-speed-btn" data-speed="2">2x</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * 绑定播放器交互事件
 */
function initAudioPlayerEvents(container) {
    const audio = container.querySelector('#audioElement');
    const playPauseBtn = container.querySelector('#playPauseBtn');
    const playIcon = container.querySelector('#playIcon');
    const pauseIcon = container.querySelector('#pauseIcon');
    const seekBackBtn = container.querySelector('#seekBackBtn');
    const seekForwardBtn = container.querySelector('#seekForwardBtn');
    const progressFill = container.querySelector('#progressFill');
    const progressThumb = container.querySelector('#progressThumb');
    const progressTrack = container.querySelector('#progressTrack');
    const currentTimeEl = container.querySelector('#currentTime');
    const totalTimeEl = container.querySelector('#totalTime');
    const muteBtn = container.querySelector('#muteBtn');
    const volumeIcon = container.querySelector('#volumeIcon');
    const muteIcon = container.querySelector('#muteIcon');
    const volumeSlider = container.querySelector('#volumeSlider');
    const speedBtns = container.querySelectorAll('.audio-speed-btn');

    // 播放/暂停
    playPauseBtn.addEventListener('click', () => {
        if (audio.paused) {
            audio.play();
        } else {
            audio.pause();
        }
    });

    audio.addEventListener('play', () => {
        playIcon.classList.add('d-none');
        pauseIcon.classList.remove('d-none');
    });

    audio.addEventListener('pause', () => {
        playIcon.classList.remove('d-none');
        pauseIcon.classList.add('d-none');
    });

    // 时长加载完成后显示总时长
    audio.addEventListener('loadedmetadata', () => {
        totalTimeEl.textContent = formatAudioTime(audio.duration);
    });

    // 进度更新
    audio.addEventListener('timeupdate', () => {
        if (!audio.duration) return;
        const pct = (audio.currentTime / audio.duration) * 100;
        progressFill.style.width = `${pct}%`;
        progressThumb.style.left = `${pct}%`;
        currentTimeEl.textContent = formatAudioTime(audio.currentTime);
    });

    // 点击进度条跳转
    progressTrack.addEventListener('click', (e) => {
        const rect = progressTrack.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        audio.currentTime = pct * audio.duration;
    });

    // 拖拽进度条
    let isDragging = false;
    progressThumb.addEventListener('mousedown', () => { isDragging = true; });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const rect = progressTrack.getBoundingClientRect();
        const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        audio.currentTime = pct * audio.duration;
    });
    document.addEventListener('mouseup', () => { isDragging = false; });

    // 倒退 / 快进
    seekBackBtn.addEventListener('click', () => {
        audio.currentTime = Math.max(0, audio.currentTime - 10);
    });
    seekForwardBtn.addEventListener('click', () => {
        audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
    });

    // 静音切换
    muteBtn.addEventListener('click', () => {
        audio.muted = !audio.muted;
        volumeIcon.classList.toggle('d-none', audio.muted);
        muteIcon.classList.toggle('d-none', !audio.muted);
    });

    // 音量滑条
    volumeSlider.addEventListener('input', () => {
        audio.volume = parseFloat(volumeSlider.value);
        const muted = audio.volume === 0;
        volumeIcon.classList.toggle('d-none', muted);
        muteIcon.classList.toggle('d-none', !muted);
    });

    // 播放速度
    speedBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            audio.playbackRate = parseFloat(btn.dataset.speed);
            speedBtns.forEach(b => {
                b.classList.remove('btn-secondary', 'active');
                b.classList.add('btn-outline-secondary');
            });
            btn.classList.remove('btn-outline-secondary');
            btn.classList.add('btn-secondary', 'active');
        });
    });
}

/**
 * 将秒数格式化为 m:ss
 */
function formatAudioTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

/**
 * 转义 HTML 特殊字符，防止 XSS
 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * 转义 HTML attribute 中的特殊字符
 */
function escapeAttr(str) {
    return String(str).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Only load tasks if user is authenticated
    // This will be called from auth.js after successful login
    console.log('App initialized');
});
