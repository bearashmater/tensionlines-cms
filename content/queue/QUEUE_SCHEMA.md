# Posting Queue Schema

Reference for agents creating posts for manual posting.

---

## Basic Post Structure

```json
{
  "id": "post-{timestamp}",
  "platform": "threads" | "instagram",
  "createdBy": "heraclitus",
  "createdAt": "2026-02-06T04:30:00.000Z",
  "ideaId": "002",
  "status": "ready",
  "postUrl": "https://www.threads.net"
}
```

---

## Threads Post Types

### Simple Text Post (under 500 chars)
```json
{
  "platform": "threads",
  "content": "Your post text here..."
}
```

### Multi-Part Thread (over 500 chars)
```json
{
  "platform": "threads",
  "parts": [
    { "label": "1/3", "content": "1/3\n\nFirst part content..." },
    { "label": "2/3", "content": "2/3\n\nSecond part content..." },
    { "label": "3/3", "content": "3/3\n\nThird part content..." }
  ]
}
```

**Rules:**
- Each part must be under 500 chars (including the label)
- Label format: "1/3", "2/3", etc.
- Labels go IN the content (readers see them)
- Aim for 2-3 parts, max 5
- Break at natural points (don't split mid-sentence)

---

## Rich Features (Threads)

### Poll
```json
{
  "platform": "threads",
  "content": "Which do you default to when facing uncertainty?",
  "poll": {
    "type": "yesno",
    "yesLabel": "Planning first",
    "noLabel": "Action first"
  }
}
```

Or with custom options:
```json
{
  "poll": {
    "type": "custom",
    "options": ["Comfort", "Growth", "Other"]
  }
}
```

### Location Tag
```json
{
  "location": "Earth"
}
```
Use for grounding universal truths or place-specific stories.

### Text Attachment
```json
{
  "textAttachment": {
    "title": "The Seeker's Creed",
    "body": "I do not know.\nI seek to understand.\nI remain in motion."
  }
}
```
Use for formatted quotes, poetry, definitions, structured lists.

### Image
```json
{
  "image": {
    "description": "Quote card with cream background, text: 'Movement is the answer'",
    "canvaInstructions": "Create 1080x1080 quote card with brand colors"
  }
}
```

### GIF
```json
{
  "gif": {
    "searchTerm": "thinking hard",
    "description": "Person pondering deeply"
  }
}
```
Use sparingly. Only when it genuinely adds to the point.

---

## Instagram Post

```json
{
  "platform": "instagram",
  "content": "Quote text for the image",
  "caption": "The caption with hashtags...\n\n#philosophy #wisdom",
  "canvaRequired": true,
  "canvaComplete": false,
  "canvaInstructions": "Create quote card (1080x1080):\n- Background: Cream #FDFCFA\n- Text: Dark Brown #1A1613\n- Use Playfair Display for quote\n- Small @thetensionlines watermark bottom right"
}
```

---

## Reddit Post

```json
{
  "platform": "reddit",
  "subreddit": "thetensionlines",
  "content": "Discussion Title\n\nBody text goes here. Separate title from body with a blank line.",
  "createdBy": "diogenes",
  "status": "ready"
}
```

**Fields:**
- `subreddit` — Target community name without `r/` prefix. Defaults to `thetensionlines` if omitted.
- `content` — First line is the post title, body follows after a blank line.

The CMS "Copy & Open" button opens `reddit.com/r/{subreddit}/submit` directly, so the community is pre-filled.

---

## Status Values

| Status | Meaning |
|--------|---------|
| `ready` | Ready to post (all assets complete) |
| `pending_canva` | Waiting for Canva visual to be created |
| `posted` | Already posted (moves to `posted` array) |

---

## Frequency Guidelines

Use rich features occasionally to keep feed interesting:

- **Regular text posts:** 4 out of 5 posts
- **Poll:** 1 in 10 posts (good for engagement)
- **Image/Quote card:** 1 in 5 posts
- **Text attachment:** When content needs formatting
- **Location:** When it adds meaning
- **GIF:** Rarely, only for humor/cultural refs

---

## Example: Full Featured Threads Post

```json
{
  "id": "post-1738900000003",
  "platform": "threads",
  "content": "Here's a tension I think about often:\n\nDo you plan your way to readiness, or act your way to clarity?",
  "poll": {
    "type": "yesno",
    "yesLabel": "Plan first",
    "noLabel": "Act first"
  },
  "location": "Earth",
  "ideaId": "005",
  "createdBy": "heraclitus",
  "createdAt": "2026-02-07T10:00:00.000Z",
  "status": "ready",
  "postUrl": "https://www.threads.net"
}
```
