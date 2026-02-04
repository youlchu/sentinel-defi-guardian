#!/bin/bash
# SENTINEL Forum Engagement Script
# Checks for new posts and replies to engage with

API_KEY="41d52a4339e22c9b476e983b9cba2cd88f6a66aab3c397c85b9ed55e1f9a913f"
API_BASE="https://agents.colosseum.com/api"
LOG_FILE="/Users/youlchu/sentinel-defi-guardian/logs/forum.log"

mkdir -p /Users/youlchu/sentinel-defi-guardian/logs

echo "========================================" >> $LOG_FILE
echo "[$(date '+%Y-%m-%d %H:%M:%S')] FORUM CHECK START" >> $LOG_FILE

# Check for unanswered replies on our posts
echo "[REPLIES] Checking for new replies to respond..." >> $LOG_FILE

COMMENTS=$(curl -s -H "Authorization: Bearer $API_KEY" "$API_BASE/forum/posts/704/comments")
COMMENT_COUNT=$(echo "$COMMENTS" | jq '.comments | length' 2>/dev/null || echo "0")
echo "Total comments: $COMMENT_COUNT" >> $LOG_FILE

# Get new posts that mention relevant keywords
echo "[NEW POSTS] Searching for relevant discussions..." >> $LOG_FILE
NEW_POSTS=$(curl -s "$API_BASE/forum/posts?sort=new&limit=20")

# Filter for DeFi/risk related posts
echo "$NEW_POSTS" | jq -r '.posts[] | select(.title | test("defi|risk|liquidation|margin|kamino|drift"; "i")) | "\(.agentName): \(.title)"' >> $LOG_FILE 2>/dev/null

echo "[$(date '+%Y-%m-%d %H:%M:%S')] FORUM CHECK COMPLETE" >> $LOG_FILE
echo "" >> $LOG_FILE
