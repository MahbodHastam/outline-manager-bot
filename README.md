<div align="center">
  <br />
  <p>
    <h1>Outline Manager Bot</h1>
  </p>
  <p>
    A Telegram bot to manage keys on your <a href="https://getoutline.org/">Outline VPN</a> server.
  </p>
</div>

---

## Table of Contents

- [About The Project](#-about-the-project)
- [Features](#-features)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Configuration](#️-configuration)
- [SSH migration](#-ssh-migration)
- [Development](#-development)

---

## About The Project

This project provides a Telegram bot that acts as a user-friendly interface for **Outline VPN servers**. It automates the process of creating, deleting, and managing access keys, making it simple for an administrator to share VPN access without needing to manually use the Outline Manager desktop application for every user.

## Features

- **Server management** — Add multiple Outline servers via their Management API URL
- **Key management** — Create and delete access keys directly from Telegram
- **Custom domains** — Use custom domain URLs instead of server IPs when sharing access links
- **Key aliases** — Short, shareable URLs (e.g. `https://your-domain.com/USER-UNIQUE-ID`) when using custom domains
- **SSH migration** — Move Outline from an old host to a new host

## Getting Started

### Prerequisites

1. **An Outline Server** — You need a running Outline server
2. **Outline API URL** — Get this from your Outline Manager desktop app: `Server Settings` → copy the `Management API URL`
3. **A Telegram Bot Token** — Create a new bot via [@BotFather](https://t.me/BotFather) on Telegram

### Installation

1. **Clone the repository:**

   ```sh
   git clone https://github.com/MahbodHastam/outline-manager-bot.git
   cd outline-manager-bot
   ```

2. **Create and configure your environment file:**

   ```sh
   cp .env.example .env
   # Edit .env and add your BOT_TOKEN and DATABASE_URL
   ```

3. **Install dependencies and set up the database:**

   ```sh
   pnpm install
   pnpm exec prisma generate
   pnpm exec prisma db push
   pnpm build
   ```

4. **Run the bot:**

   ```sh
   pnpm start
   ```

   You can use tmux or set up a system service. I prefer tmux for now.

   ```sh
   tmux
   pnpm start
   # Press CTRL+B then D to detach
   ```

## Configuration

| Variable             | Description                                                                      | Example                                     |
| -------------------- | -------------------------------------------------------------------------------- | ------------------------------------------- |
| `BOT_TOKEN`          | **Required.** Your Telegram bot token from [@BotFather](https://t.me/BotFather). | `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11` |
| `DATABASE_URL`       | **Required.** SQLite database path (relative to prisma directory).               | `file:./database.db`                        |
| `CUSTOM_DOMAIN_PORT` | Port for the custom domain HTTP server. Default: 8080 (dev) or 80 (production).  | `80`                                        |
| `ENV`                | Set to `production` to use port 80 for the custom domain server.                 | `production`                                |

## SSH migration

From **Manage servers** → open a server → **Migrate to new server**, the bot walks through SSH details for the current Outline host and the target host. It verifies the **new** server is **Ubuntu LTS** with **`VERSION_ID` ≥ 22.04** (e.g. 22.04, 24.04), checks Docker, stops Outline-related containers on the old host, then runs **`docker save` → `docker load`** and **`tar`** so that **large data flows directly from old → new over SSH** (the new host connects to the old; the bot does not relay image/tar bytes). Containers are recreated on the new host using `docker inspect` metadata.

### Prerequisites

- **Network:** The machine running the bot must reach **both** hosts on SSH (control only). The **new** server must be able to reach the **old** server on its SSH port — that path carries the Docker and `/opt/outline` streams.
- **Privileges:** On **both** hosts, the SSH user must run **`docker`** and access **`/opt/outline`** without interactive **sudo** (often `root` or passwordless sudo). The **new** host may auto-install **`sshpass`** (via `apt`) if missing, so it can open SSH to the old host non-interactively.
- **Target OS:** New server must be **Ubuntu LTS** with **22.04 or newer** (e.g. 24.04 LTS).
- **Telegram and passwords:** The bot uses **password** SSH auth. Use a **temporary SSH password** and rotate it after migration.
- **Native dependency:** `ssh2` may require allowed install scripts (e.g. `pnpm approve-builds`) so native addons can build on your platform.

## Development

- **Development mode** (with hot reload):

  ```sh
  pnpm dev
  ```

- **Database Studio** (Prisma GUI):

  ```sh
  pnpm db:studio
  ```

- **Code formatting:**

  ```sh
  pnpm format
  ```
