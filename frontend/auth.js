// Cognito 认证管理
class CognitoAuth {
    constructor(config) {
        this.config = config;
        this.userPool = new AmazonCognitoIdentity.CognitoUserPool({
            UserPoolId: config.userPoolId,
            ClientId: config.clientId
        });
        this.currentUser = null;
        this.idToken = null;
    }

    // 注册新用户
    signUp(email, password, name) {
        return new Promise((resolve, reject) => {
            const attributeList = [
                new AmazonCognitoIdentity.CognitoUserAttribute({
                    Name: 'email',
                    Value: email
                }),
                new AmazonCognitoIdentity.CognitoUserAttribute({
                    Name: 'name',
                    Value: name
                })
            ];

            this.userPool.signUp(email, password, attributeList, null, (err, result) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(result.user);
            });
        });
    }

    // 确认注册（验证码）
    confirmSignUp(username, code) {
        return new Promise((resolve, reject) => {
            const userData = {
                Username: username,
                Pool: this.userPool
            };
            const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

            cognitoUser.confirmRegistration(code, true, (err, result) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(result);
            });
        });
    }

    // 登录
    signIn(email, password) {
        return new Promise((resolve, reject) => {
            const authenticationData = {
                Username: email,
                Password: password
            };
            const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails(authenticationData);

            const userData = {
                Username: email,
                Pool: this.userPool
            };
            const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

            cognitoUser.authenticateUser(authenticationDetails, {
                onSuccess: (result) => {
                    this.currentUser = cognitoUser;
                    this.idToken = result.getIdToken().getJwtToken();
                    resolve({
                        user: cognitoUser,
                        token: this.idToken,
                        accessToken: result.getAccessToken().getJwtToken(),
                        refreshToken: result.getRefreshToken().getToken()
                    });
                },
                onFailure: (err) => {
                    reject(err);
                },
                newPasswordRequired: (userAttributes, requiredAttributes) => {
                    // 首次登录需要修改密码
                    reject(new Error('需要修改初始密码'));
                }
            });
        });
    }

    // 退出登录
    signOut() {
        const cognitoUser = this.userPool.getCurrentUser();
        if (cognitoUser) {
            cognitoUser.signOut();
        }
        this.currentUser = null;
        this.idToken = null;
    }

    // 获取当前用户
    getCurrentUser() {
        return new Promise((resolve, reject) => {
            const cognitoUser = this.userPool.getCurrentUser();
            
            if (!cognitoUser) {
                reject(new Error('未登录'));
                return;
            }

            cognitoUser.getSession((err, session) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (!session.isValid()) {
                    reject(new Error('会话已过期'));
                    return;
                }

                this.currentUser = cognitoUser;
                this.idToken = session.getIdToken().getJwtToken();

                // 获取用户属性
                cognitoUser.getUserAttributes((err, attributes) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const userInfo = {};
                    attributes.forEach(attr => {
                        userInfo[attr.Name] = attr.Value;
                    });

                    resolve({
                        username: cognitoUser.getUsername(),
                        attributes: userInfo,
                        token: this.idToken
                    });
                });
            });
        });
    }

    // 获取 ID Token（用于 API 请求）
    getIdToken() {
        return this.idToken;
    }

    // 刷新 Token
    refreshSession() {
        return new Promise((resolve, reject) => {
            const cognitoUser = this.userPool.getCurrentUser();
            
            if (!cognitoUser) {
                reject(new Error('未登录'));
                return;
            }

            cognitoUser.getSession((err, session) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (session.isValid()) {
                    this.idToken = session.getIdToken().getJwtToken();
                    resolve(this.idToken);
                } else {
                    reject(new Error('会话已过期'));
                }
            });
        });
    }
}

// 初始化认证管理器
const cognitoAuth = new CognitoAuth(COGNITO_CONFIG);

// UI 交互逻辑
document.addEventListener('DOMContentLoaded', async () => {
    const loginSection = document.getElementById('loginSection');
    const appSection = document.getElementById('appSection');
    const loginForm = document.getElementById('loginForm');
    const signUpForm = document.getElementById('signUpForm');
    const confirmForm = document.getElementById('confirmForm');
    const authMessage = document.getElementById('authMessage');

    let pendingUsername = null;

    // 显示消息
    function showMessage(message, type = 'info') {
        authMessage.className = `alert alert-${type}`;
        authMessage.textContent = message;
        authMessage.classList.remove('d-none');
        setTimeout(() => {
            authMessage.classList.add('d-none');
        }, 5000);
    }

    // 检查是否已登录
    try {
        const user = await cognitoAuth.getCurrentUser();
        showApp(user);
    } catch (err) {
        console.log('未登录:', err.message);
    }

    // 切换到注册表单
    document.getElementById('showSignUp').addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.classList.add('d-none');
        signUpForm.classList.remove('d-none');
    });

    // 切换到登录表单
    document.getElementById('showSignIn').addEventListener('click', (e) => {
        e.preventDefault();
        signUpForm.classList.add('d-none');
        loginForm.classList.remove('d-none');
    });

    // 登录
    document.getElementById('signInForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('signInEmail').value;
        const password = document.getElementById('signInPassword').value;

        try {
            const result = await cognitoAuth.signIn(email, password);
            showMessage('登录成功！', 'success');
            const user = await cognitoAuth.getCurrentUser();
            showApp(user);
        } catch (err) {
            showMessage('登录失败: ' + err.message, 'danger');
        }
    });

    // 注册
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('signUpName').value;
        const email = document.getElementById('signUpEmail').value;
        const password = document.getElementById('signUpPassword').value;

        try {
            await cognitoAuth.signUp(email, password, name);
            pendingUsername = email;
            showMessage('注册成功！请查收邮箱验证码', 'success');
            signUpForm.classList.add('d-none');
            confirmForm.classList.remove('d-none');
        } catch (err) {
            showMessage('注册失败: ' + err.message, 'danger');
        }
    });

    // 验证码确认
    document.getElementById('verifyForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('confirmCode').value;

        try {
            await cognitoAuth.confirmSignUp(pendingUsername, code);
            showMessage('验证成功！请登录', 'success');
            confirmForm.classList.add('d-none');
            loginForm.classList.remove('d-none');
        } catch (err) {
            showMessage('验证失败: ' + err.message, 'danger');
        }
    });

    // 退出登录
    document.getElementById('signOutBtn').addEventListener('click', () => {
        cognitoAuth.signOut();
        appSection.classList.add('d-none');
        loginSection.classList.remove('d-none');
        showMessage('已退出登录', 'info');
    });

    // 显示应用界面
    function showApp(user) {
        loginSection.classList.add('d-none');
        appSection.classList.remove('d-none');
        document.getElementById('userInfo').textContent = `👤 ${user.attributes.name || user.username}`;
        
        // 加载任务历史
        if (typeof loadTasks === 'function') {
            loadTasks();
        }
    }
});

// 导出给 app.js 使用
window.cognitoAuth = cognitoAuth;
