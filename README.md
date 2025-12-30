# iPod Classic Tool v3

[![Node.js](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)
[![Build Status](https://github.com/Kyle-Aaron-Merrill/Ipod-classic-tool-v3/workflows/test-multiplatform/badge.svg)](https://github.com/Kyle-Aaron-Merrill/Ipod-classic-tool-v3/actions)

A powerful desktop tool for automatically fetching and organizing music metadata for your iPod Classic. Supports multiple music services including YouTube Music, Spotify, Apple Music, Amazon Music, Tidal, and AI-powered metadata generation.

![iPod Classic Tool](build/logo.png)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Supported Music Services](#supported-music-services)
- [Testing](#testing)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## Features

✨ **Comprehensive Metadata Support**
- 🎵 Automatic album and artist detection
- 🖼️ High-quality album artwork download
- 🏷️ ID3 tag embedding for MP3 files
- 🎨 Image processing and optimization

📺 **Multi-Service Support**
- YouTube Music metadata extraction
- Spotify track and album info
- Apple Music data fetching
- Amazon Music integration
- Tidal metadata support
- YT Music API support

🤖 **AI-Powered Features**
- OpenAI GPT integration for intelligent metadata correction
- Smart album title and artist parsing
- Automatic metadata enhancement

🎯 **Ease of Use**
- Beautiful Electron GUI
- One-click setup and installation
- Automatic yt-dlp dependency management
- Cross-platform support (Windows, macOS, Linux)
- Zero configuration needed for users

🚀 **Developer Friendly**
- Modular architecture
- Easy metadata source integration
- Comprehensive test suite
- Multi-platform CI/CD testing

---

## Installation

### Quick Start

**Windows Users:**
- Download the installer or portable executable from [Releases](https://github.com/Kyle-Aaron-Merrill/Ipod-classic-tool-v3/releases)
- Run and go!

**For Detailed Installation Instructions:**
See [INSTALLATION.md](INSTALLATION.md) for step-by-step setup guides for all platforms.

### System Requirements

- **Node.js 16+** (for development)
- **Windows 10+**, **macOS 10.13+**, or **Linux** (Ubuntu, Debian, Fedora)
- **Internet connection** (for metadata fetching)

### Prerequisites

- Node.js: https://nodejs.org/
- (Optional) OpenAI API key for GPT metadata features

---

## Usage

### Launch the Application

```bash
# From source
npm start

# From packaged app
# Run the installer or portable .exe
```

### Basic Workflow

1. **Add Music Files**
   - Select MP3 files or folders
   - App scans for missing metadata

2. **Select Metadata Source**
   - Choose from YouTube Music, Spotify, Apple Music, etc.
   - Or use AI-powered GPT suggestions

3. **Review and Confirm**
   - Preview extracted metadata
   - Make manual corrections if needed

4. **Apply Metadata**
   - Embed ID3 tags into MP3 files
   - Download and attach album artwork

### Configuration

**Environment Variables** (optional):
```bash
# For OpenAI GPT features
OPENAI_API_KEY=your_api_key_here
```

### Example: Using from Command Line

```bash
# Run tests
npm test

# Test platform compatibility
npm test:platform

# Build packaged applications (Windows)
npm run build:win
```

---

## Supported Music Services

| Service | Album Info | Track Info | Cover Art |
|---------|:----------:|:----------:|:---------:|
| YouTube Music | ✅ | ✅ | ✅ |
| Spotify | ✅ | ✅ | ✅ |
| Apple Music | ✅ | ✅ | ✅ |
| Amazon Music | ✅ | ✅ | ✅ |
| Tidal | ✅ | ✅ | ✅ |
| YT Music API | ✅ | ✅ | ✅ |
| OpenAI GPT | ✅ | ✅ | ❌ |

---

## Testing

### Run Tests

```bash
# Run all tests
npm test

# Test platform-specific functionality
npm test:platform
```

### Test Coverage

The test suite validates:
- Syntax and module loading
- Cross-platform compatibility
- Metadata extraction accuracy
- File I/O operations
- Native dependency integration

See [TEST_PLAN.md](TEST_PLAN.md) for comprehensive testing documentation.

---

## Contributing

We welcome contributions! Here's how to help:

### Report Bugs

1. Check existing [Issues](https://github.com/Kyle-Aaron-Merrill/Ipod-classic-tool-v3/issues)
2. Provide:
   - Clear description of the problem
   - Steps to reproduce
   - Expected vs. actual behavior
   - Your environment (OS, Node version)

### Submit Enhancements

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Add tests if applicable
5. Commit: `git commit -m "Add: your feature description"`
6. Push: `git push origin feature/your-feature`
7. Submit a Pull Request

### Code Style

- Use ES6+ syntax
- Follow existing code patterns
- Add comments for complex logic
- Test before submitting

---

## License

This project is licensed under the **ISC License** - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

**Built With:**
- [Electron](https://www.electronjs.org/) - Desktop application framework
- [Puppeteer](https://pptr.dev/) - Browser automation
- [Cheerio](https://cheerio.js.org/) - HTML parsing
- [node-id3](https://www.npmjs.com/package/node-id3) - MP3 metadata embedding
- [sharp](https://sharp.pixelplumbing.com/) - Image processing
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - YouTube audio extraction
- [OpenAI API](https://openai.com/) - AI metadata enhancement

**Inspiration:**
- Classic iPod nostalgia 🎵
- The need for robust music metadata management
- Community feedback and contributions

---

## Contact

**Questions or Suggestions?**
- Open an [Issue](https://github.com/Kyle-Aaron-Merrill/Ipod-classic-tool-v3/issues)
- Check the [Discussions](https://github.com/Kyle-Aaron-Merrill/Ipod-classic-tool-v3/discussions) tab

---

**Happy organizing! 🎶**
