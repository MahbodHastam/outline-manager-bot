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
- [Development](#-development)

---

## About The Project

This project provides a Telegram bot that acts as a user-friendly interface for **Outline VPN servers**. It automates the process of creating, deleting, and managing access keys, making it simple for an administrator to share VPN access without needing to manually use the Outline Manager desktop application for every user.

## Features

- **Server management** — Add multiple Outline servers via their Management API URL
- **Key management** — Create and delete access keys directly from Telegram
- **Custom domains** — Use custom domain URLs instead of server IPs when sharing access links
- **Key aliases** — Short, shareable URLs (e.g. `https://your-domain.com/USER-UNIQUE-ID`) when using custom domains

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

   For long-running sessions, you can use tmux:

   ```sh
   tmux
   pnpm start
   # Press CTRL+A then D to detach
   ```

## Configuration

| Variable              | Description                                                                 | Example                                     |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------- |
| `BOT_TOKEN`           | **Required.** Your Telegram bot token from [@BotFather](https://t.me/BotFather). | `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11` |
| `DATABASE_URL`        | **Required.** SQLite database path (relative to prisma directory).          | `file:./database.db`                        |
| `CUSTOM_DOMAIN_PORT`  | Port for the custom domain HTTP server. Default: 8080 (dev) or 80 (production). | `80`                                        |
| `ENV`                 | Set to `production` to use port 80 for the custom domain server.             | `production`                                |

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
