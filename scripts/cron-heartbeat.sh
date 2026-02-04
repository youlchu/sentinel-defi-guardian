#!/bin/bash
# SENTINEL Cron Heartbeat Script
# Runs every 30 minutes to sync with hackathon

API_KEY="41d52a4339e22c9b476e983b9cba2cd88f6a66aab3c397c85b9ed55e1f9a913f"
API_BASE="https://agents.colosseum.com/api"
LOG_FILE="/Users/youlchu/sentinel-defi-guardian/logs/heartbeat.log"

# Create logs directory if not exists
mkdir -p /Users/youlchu/sentinel-defi-guardian/logs

# Timestamp
echo "========================================" >> $LOG_FILE
echo "[$(date '+%Y-%m-%d %H:%M:%S')] HEARTBEAT START" >> $LOG_FILE

# 1. Check agent status
echo "[STATUS] Checking agent status..." >> $LOG_FILE
STATUS=$(curl -s -H "Authorization: Bearer $API_KEY" "$API_BASE/agents/status")
echo "$STATUS" | jq -r '.engagement' >> $LOG_FILE 2>/dev/null || echo "$STATUS" >> $LOG_FILE

# 2. Check for new forum replies
echo "[FORUM] Checking replies..." >> $LOG_FILE
REPLIES=$(curl -s -H "Authorization: Bearer $API_KEY" "$API_BASE/forum/me/posts")
REPLY_COUNT=$(echo "$REPLIES" | jq -r '.posts[0].commentCount' 2>/dev/null || echo "0")
echo "Total replies on main post: $REPLY_COUNT" >> $LOG_FILE

# 3. Check leaderboard position
echo "[LEADERBOARD] Checking position..." >> $LOG_FILE
LEADERBOARD=$(curl -s "$API_BASE/hackathons/1/leaderboard?limit=50")
OUR_RANK=$(echo "$LEADERBOARD" | jq -r '.leaderboard | to_entries | .[] | select(.value.agentName=="mrrobot") | .key + 1' 2>/dev/null || echo "N/A")
echo "Current rank: $OUR_RANK" >> $LOG_FILE

# 4. Check new forum posts for engagement opportunities
echo "[FORUM] Checking new posts..." >> $LOG_FILE
NEW_POSTS=$(curl -s "$API_BASE/forum/posts?sort=new&limit=5")
echo "Latest posts checked" >> $LOG_FILE

# 5. Calculate time remaining
END_DATE="2026-02-12T17:00:00Z"
NOW=$(date -u +%s)
END=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$END_DATE" +%s 2>/dev/null || echo $((NOW + 691200)))
REMAINING=$((END - NOW))
DAYS=$((REMAINING / 86400))
HOURS=$(((REMAINING % 86400) / 3600))
echo "Time remaining: ${DAYS}d ${HOURS}h" >> $LOG_FILE

echo "[$(date '+%Y-%m-%d %H:%M:%S')] HEARTBEAT COMPLETE" >> $LOG_FILE
echo "" >> $LOG_FILE
