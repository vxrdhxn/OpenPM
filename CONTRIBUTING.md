# Contributing to OpenPM

First off, thank you for considering contributing to OpenPM! It's people like you that make OpenPM a great tool for everyone.

## Code of Conduct

By participating in this project, you are expected to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the issue tracker to see if the problem has already been reported. When you are creating a bug report, please include as many details as possible:
* Use a clear and descriptive title.
* Describe the exact steps which reproduce the problem.
* Provide specific examples to demonstrate the steps.
* Describe the behavior you observed after following the steps and point out what exactly is the problem with that behavior.
* Explain which behavior you expected to see instead and why.
* Include screenshots or animated GIFs if possible.

**Security Vulnerabilities:** Please see our [Security Policy](SECURITY.md) for how to report security issues privately.

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues.
* Use a clear and descriptive title for the issue to identify the suggestion.
* Provide a step-by-step description of the suggested enhancement in as many details as possible.
* Explain why this enhancement would be useful to most OpenPM users.

### Pull Requests

1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. Ensure the test suite passes (`npm test` — if available).
4. Make sure your code lints (`npm run lint`).
5. Format your code (e.g. Prettier).
6. Update the documentation (README.md, etc.) if your changes affect it.
7. Issue that pull request!

## Local Development Setup

OpenPM uses a monorepo structure with npm workspaces.

### Prerequisites
* Node.js >= 20
* Docker & Docker Compose
* Git

### Steps
1. Clone the repository: `git clone https://github.com/vxrdhxn/OpenPM.git && cd OpenPM`
2. Set up environment variables: `cp .env.example .env`
3. Start infrastructure (Postgres & Redis): `docker-compose up -d postgres redis`
4. Install dependencies: `npm install`
5. Run migrations: `npm run migrate`
6. Start development servers in separate terminals:
   * `npm run dev:api`
   * `npm run dev:worker`
   * `npm run dev:frontend`

The frontend will be available at `http://localhost:3001` and the API at `http://localhost:3000`.

## Architecture Overview

Please refer to the Architecture section in the [README.md](README.md) to understand the high-level design of the application.
