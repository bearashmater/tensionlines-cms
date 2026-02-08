# HEARTBEAT.md - Periodic Checks

## Every Heartbeat

1. Check CMS server is running (`curl -s localhost:3001/api/dashboard`)
2. Check for stuck tasks (red alerts in mission control)
3. Check engagement queue — any items waiting?

## Every Few Hours

4. Review posting queue — anything ready to publish?
5. Check Bluesky notifications for new engagement opportunities
6. Review reply queue for pending responses

## Daily

7. Review and update `memory/YYYY-MM-DD.md` with session activity
8. Check ideas bank for ideas ready to draft
9. Run engagement scan if not run today
