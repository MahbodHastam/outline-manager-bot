<div align="center">
  <br />
  <p>
    <h1>Outline Manager Bot</h1>
  </p>
  <p>
    A Telegram bot to manage keys on your <a href="https://getoutline.org/">Outline VPN</a> server.
  </p>
</div>

<!-- <p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/github/license/MahbodHastam/outline-manager-bot" alt="License"></a>
</p> -->

---

## 📖 Table of Contents

- [About The Project](#-about-the-project)
- [Getting Started](#-getting-started)
  - [Installation](#-installation)
- [Configuration](#️-configuration)

---

## About The Project

This project provides a Telegram bot that acts as a user-friendly interface for an **Outline VPN server**. It automates the process of creating, deleting, and managing access keys, making it incredibly simple for an administrator to share VPN access without needing to manually use the Outline Manager desktop application for every user.

## Getting Started

Before you begin, make sure you have the following:

1.  **An Outline Server**: You need a running Outline server.
2.  **Outline API URL**: You can get this from your Outline Manager desktop app. Go to `Server Settings` and copy the `Management API URL`.
3.  **A Telegram Bot Token**: Create a new bot by talking to [@BotFather](https://t.me/BotFather) on Telegram and get your `Bot Token`.

### Installation

1.  **Clone the repository:**

    ```sh
    git clone https://github.com/MahbodHastam/outline-manager-bot.git
    cd outline-manager-bot
    ```

2.  **Create and configure your environment file:**

    ```sh
    cp .env.example .env
    vim .env
    ```

3.  **Install the dependencies and build the bot:**

    ```sh
    pnpm install
    pnpm build
    ```

4.  **Run the bot using tmux:**

    ```sh
    tmux
    pnpm start
    ```

5.  **Press `CTRL+A CTRL+D` to detach the screen**

## Configuration

| Variable       | Description                                                                                        | Example                                     |
| -------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `BOT_TOKEN`    | **Required.** The token for your Telegram bot, obtained from [@BotFather](https://t.me/BotFather). | `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11` |
| `DATABASE_URL` | **Required.** Your database path (relative to prisma directory).                                   | `file:./database.db`                        |
