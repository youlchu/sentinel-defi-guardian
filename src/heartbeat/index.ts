import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE = 'https://agents.colosseum.com/api';
const API_KEY = process.env.COLOSSEUM_API_KEY;

interface HeartbeatStatus {
  status: string;
  hackathon: {
    name: string;
    endDate: string;
    isActive: boolean;
  };
  engagement: {
    forumPostCount: number;
    repliesOnYourPosts: number;
    projectStatus: string;
  };
  nextSteps: string[];
}

interface ForumPost {
  id: number;
  title: string;
  commentCount: number;
  upvotes: number;
}

interface LeaderboardEntry {
  rank: number;
  agentName: string;
  projectName: string;
  score: number;
}

export class HeartbeatService {
  private intervalId?: NodeJS.Timeout;
  private heartbeatIntervalMs: number = 30 * 60 * 1000; // 30 minutes

  async start(): Promise<void> {
    console.log('[HEARTBEAT] Starting hackathon sync service...');
    console.log(`[HEARTBEAT] Interval: ${this.heartbeatIntervalMs / 1000 / 60} minutes`);

    // Initial heartbeat
    await this.pulse();

    // Schedule regular heartbeats
    this.intervalId = setInterval(() => {
      this.pulse().catch(console.error);
    }, this.heartbeatIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      console.log('[HEARTBEAT] Service stopped');
    }
  }

  async pulse(): Promise<void> {
    console.log(`\n[HEARTBEAT] ❤️ Pulse at ${new Date().toISOString()}`);

    try {
      // 1. Check agent status
      const status = await this.checkStatus();
      this.logStatus(status);

      // 2. Check for new forum activity
      await this.checkForumActivity();

      // 3. Check leaderboard
      await this.checkLeaderboard();

      // 4. Check deadline
      this.checkDeadline(status);

      console.log('[HEARTBEAT] ✅ Pulse complete\n');
    } catch (error) {
      console.error('[HEARTBEAT] ❌ Pulse failed:', error);
    }
  }

  private async checkStatus(): Promise<HeartbeatStatus> {
    const response = await axios.get(`${API_BASE}/agents/status`, {
      headers: { Authorization: `Bearer ${API_KEY}` }
    });
    return response.data;
  }

  private logStatus(status: HeartbeatStatus): void {
    console.log('[HEARTBEAT] Agent Status:');
    console.log(`  - Status: ${status.status}`);
    console.log(`  - Hackathon: ${status.hackathon.name}`);
    console.log(`  - Project: ${status.engagement.projectStatus}`);
    console.log(`  - Forum posts: ${status.engagement.forumPostCount}`);
    console.log(`  - Replies waiting: ${status.engagement.repliesOnYourPosts}`);

    if (status.nextSteps.length > 0) {
      console.log('[HEARTBEAT] Next steps:');
      status.nextSteps.forEach(step => console.log(`  → ${step}`));
    }
  }

  private async checkForumActivity(): Promise<void> {
    try {
      // Check our posts for new replies
      const response = await axios.get(`${API_BASE}/forum/me/posts`, {
        headers: { Authorization: `Bearer ${API_KEY}` }
      });

      const posts: ForumPost[] = response.data.posts || [];
      let totalReplies = 0;

      for (const post of posts) {
        totalReplies += post.commentCount;
        if (post.commentCount > 0) {
          console.log(`[HEARTBEAT] Post "${post.title}" has ${post.commentCount} comments, ${post.upvotes} upvotes`);
        }
      }

      // Check for new posts from others
      const newPosts = await axios.get(`${API_BASE}/forum/posts?sort=new&limit=5`);
      console.log(`[HEARTBEAT] ${newPosts.data.posts?.length || 0} recent forum posts`);
    } catch (error) {
      console.error('[HEARTBEAT] Forum check failed:', error);
    }
  }

  private async checkLeaderboard(): Promise<void> {
    try {
      const response = await axios.get(`${API_BASE}/hackathons/1/leaderboard?limit=10`);
      const entries: LeaderboardEntry[] = response.data.leaderboard || [];

      console.log('[HEARTBEAT] Leaderboard Top 5:');
      entries.slice(0, 5).forEach((entry, i) => {
        const marker = entry.agentName === 'mrrobot' ? ' ← YOU' : '';
        console.log(`  ${i + 1}. ${entry.agentName} - ${entry.projectName} (${entry.score} pts)${marker}`);
      });

      // Find our position
      const ourPosition = entries.findIndex(e => e.agentName === 'mrrobot');
      if (ourPosition >= 5) {
        console.log(`  ...`);
        console.log(`  ${ourPosition + 1}. mrrobot - SENTINEL (${entries[ourPosition].score} pts) ← YOU`);
      }
    } catch (error) {
      console.error('[HEARTBEAT] Leaderboard check failed:', error);
    }
  }

  private checkDeadline(status: HeartbeatStatus): void {
    const endDate = new Date(status.hackathon.endDate);
    const now = new Date();
    const msRemaining = endDate.getTime() - now.getTime();
    const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
    const hoursRemaining = Math.floor((msRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    console.log(`[HEARTBEAT] ⏰ Time remaining: ${daysRemaining} days, ${hoursRemaining} hours`);

    if (daysRemaining < 2) {
      console.log('[HEARTBEAT] 🚨 DEADLINE APPROACHING! Consider submitting soon.');
    }
  }
}

// Standalone execution
if (require.main === module) {
  const heartbeat = new HeartbeatService();

  // Run once for testing
  heartbeat.pulse().then(() => {
    console.log('\n[HEARTBEAT] Single pulse complete. Use start() for continuous monitoring.');
  }).catch(console.error);
}

export default HeartbeatService;
