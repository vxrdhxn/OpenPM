# Security Policy

## Supported Versions

Currently, only the main branch (`master`/`main`) and the latest tagged release are actively supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < Latest| :x:                |

## Reporting a Vulnerability

We take the security of OpenPM seriously. Since OpenPM is an open-source, self-hosted platform, security vulnerabilities can impact users deploying the software on their own infrastructure.

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them using **GitHub Security Advisories**:
1. Go to the [Security Advisories page](../../security/advisories).
2. Click **Report a vulnerability**.
3. Provide a descriptive summary, details of the vulnerability, and steps to reproduce.

### Response SLAs
* We will acknowledge receipt of your vulnerability report within **48 hours**.
* We aim to triage and confirm the vulnerability within **1 week**.
* For confirmed issues, we will provide a timeline for a fix and issue a patch as soon as possible.

### Out of Scope
* Attacks requiring physical access to a user's device.
* Social engineering attacks against OpenPM users.
* Denial of Service (DoS) attacks requiring massive volumes of traffic, unless caused by a specific, easily reproducible application-layer bug.
* Issues in third-party dependencies (unless OpenPM is misusing them in a way that creates a vulnerability). Please report those to the respective upstream maintainers, although we appreciate a heads-up so we can update our dependencies.

Thank you for helping keep OpenPM safe!
