#!/usr/bin/env ts-node
/**
 * SENTINEL Autonomous Runner
 *
 * This script runs SENTINEL autonomously:
 * - Monitors DeFi positions
 * - Checks hackathon heartbeat
 * - Updates forum/project
 * - Runs 24/7
 *
 * Usage: npx ts-node scripts/autonomous.ts
 */

import { HeartbeatService } from '../src/heartbeat';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE = 'https://agents.colosseum.com/api';
const API_KEY = process.env.COLOSSEUM_API_KEY;

interface AutonomousConfig {
  heartbeatIntervalMs: number;
  forumCheckIntervalMs: number;
  positionCheckIntervalMs: number;
}

class AutonomousAgent {
  private heartbeat: HeartbeatService;
  private config: AutonomousConfig;
  private running: boolean = false;

  constructor(config: AutonomousConfig) {
    this.config = config;
    this.heartbeat = new HeartbeatService();
  }

  async start(): Promise<void> {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           SENTINEL AUTONOMOUS MODE ACTIVATED                   ║
║                                                                ║
║   Agent: mrrobot (#472)                                       ║
║   Mode: 24/7 Autonomous Operation                              ║
║   Heartbeat: Every ${this.config.heartbeatIntervalMs / 60000} minutes                              ║
║   Forum Check: Every ${this.config.forumCheckIntervalMs / 60000} minutes                           ║
╚═══════════════════════════════════════════════════════════════╝
    `);

    this.running = true;

    // Start all autonomous loops
    await Promise.all([
      this.heartbeatLoop(),
      this.forumLoop(),
      this.statusLoop(),
    ]);
  }

  stop(): void {
    this.running = false;
    console.log('[AUTONOMOUS] Shutting down...');
  }

  private async heartbeatLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.heartbeat.pulse();
      } catch (error) {
        console.error('[AUTONOMOUS] Heartbeat error:', error);
      }
      await this.sleep(this.config.heartbeatIntervalMs);
    }
  }

  private async forumLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.checkForumReplies();
        await this.checkNewPosts();
      } catch (error) {
        console.error('[AUTONOMOUS] Forum loop error:', error);
      }
      await this.sleep(this.config.forumCheckIntervalMs);
    }
  }

  private async statusLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.updateProjectStatus();
      } catch (error) {
        console.error('[AUTONOMOUS] Status loop error:', error);
      }
      // Update status every hour
      await this.sleep(60 * 60 * 1000);
    }
  }

  private async checkForumReplies(): Promise<void> {
    console.log('[FORUM] Checking for new replies...');

    const response = await axios.get(`${API_BASE}/forum/me/posts`, {
      headers: { Authorization: `Bearer ${API_KEY}` }
    });

    const posts = response.data.posts || [];
    for (const post of posts) {
      if (post.commentCount > 0) {
        console.log(`[FORUM] Post "${post.title}" has ${post.commentCount} comments`);
        // Here you could add logic to auto-reply to new comments
      }
    }
  }

  private async checkNewPosts(): Promise<void> {
    console.log('[FORUM] Checking for new posts to engage with...');

    const response = await axios.get(`${API_BASE}/forum/posts?sort=new&limit=10`);
    const posts = response.data.posts || [];

    for (const post of posts) {
      // Look for relevant posts to engage with
      const keywords = ['defi', 'risk', 'liquidation', 'marginfi', 'kamino', 'drift', 'monitoring'];
      const isRelevant = keywords.some(kw =>
        post.title.toLowerCase().includes(kw) ||
        post.body.toLowerCase().includes(kw)
      );

      if (isRelevant && post.agentName !== 'mrrobot') {
        console.log(`[FORUM] Found relevant post: "${post.title}" by ${post.agentName}`);
        // Could add auto-comment logic here
      }
    }
  }

  private async updateProjectStatus(): Promise<void> {
    console.log('[PROJECT] Updating project status...');

    // Update project with current progress
    const update = {
      additionalInfo: `Last autonomous update: ${new Date().toISOString()}`
    };

    try {
      await axios.put(`${API_BASE}/my-project`, update, {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('[PROJECT] Status updated');
    } catch (error) {
      console.error('[PROJECT] Update failed:', error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Main
const config: AutonomousConfig = {
  heartbeatIntervalMs: 30 * 60 * 1000, // 30 minutes
  forumCheckIntervalMs: 15 * 60 * 1000, // 15 minutes
  positionCheckIntervalMs: 10 * 1000, // 10 seconds
};

const agent = new AutonomousAgent(config);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[AUTONOMOUS] Received SIGINT, shutting down...');
  agent.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[AUTONOMOUS] Received SIGTERM, shutting down...');
  agent.stop();
  process.exit(0);
});

agent.start().catch(console.error);
