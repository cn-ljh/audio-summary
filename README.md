# OpenClaw Agent Workspace

Personal workspace for OpenClaw agents, containing custom skills, configurations, and documentation.

## Repository Structure

```
.
├── skills/                       # Custom OpenClaw Skills
│   ├── audio-transcribe/         # Audio/video transcription via AWS Transcribe
│   ├── voice-memo/               # Auto-transcribe voice messages (≥30s trigger)
│   ├── docx/                     # Word document creation & editing
│   ├── xlsx/                     # Excel spreadsheet processing
│   ├── pptx/                     # PowerPoint presentation generation
│   ├── pdf/                      # PDF processing (merge, split, extract)
│   ├── imap-smtp-email/          # Email read/send via IMAP/SMTP
│   ├── notion/                   # Notion pages & database management
│   ├── reading-notes/            # Article → Notion reading notes
│   ├── wechat-automation/        # WeChat automation
│   ├── skill-creator/            # Create & optimize skills
│   └── skill-vetter/             # Security review for skills
├── docs/                         # Configuration guides & references
├── config/                       # Agent configurations
├── audio-transcribe-serverless/  # AWS SAM infrastructure for transcription
└── memory/                       # Agent memory logs
```

## Skills Overview

| Skill | Description | Auto-Trigger |
|-------|-------------|--------------|
| [audio-transcribe](skills/audio-transcribe/) | Full-featured audio/video transcription with AWS Serverless | ≥ 1 min audio |
| [voice-memo](skills/voice-memo/) | Lightweight auto-transcribe for voice/video messages | ≥ 30s voice/video |
| [docx](skills/docx/) | Create & edit Word documents | Manual |
| [xlsx](skills/xlsx/) | Excel spreadsheet operations | Manual |
| [pptx](skills/pptx/) | PowerPoint presentations | Manual |
| [pdf](skills/pdf/) | PDF processing | Manual |
| [imap-smtp-email](skills/imap-smtp-email/) | Email via IMAP/SMTP | Manual |
| [notion](skills/notion/) | Notion API integration | Manual |
| [reading-notes](skills/reading-notes/) | Save article notes to Notion | Manual |

## Getting Started

→ See [SKILLS_GUIDE.md](SKILLS_GUIDE.md) for how to import and build custom skills.
