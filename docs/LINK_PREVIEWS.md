# Link previews

> External links grow a favicon; vault paths the assistant mentions become tappable.

Rendered chat is where links appear, and links are one of the few places a plugin can make network calls on your behalf. The favicon feature fetches one icon per external domain — from DuckDuckGo's icon service, referrer-free — so you can see where a link leads before following it. The fetch happens when the message renders, not when you click, which is why it exists as a toggle: it is the difference between chat rendering that is fully local and chat rendering that contacts a third party per domain seen.

Vault-path linkify is the inverse. The assistant mentions a note by path, and Curtis checks that mention against your local vault index — no network involved. The verification step is the point: a path-shaped string that doesn't resolve to a real note stays plain text instead of becoming a wrong link.

Two rendering touches on finished assistant messages. A message that is still streaming renders as plain text — both behaviors apply once the final render lands.

## External links

Every `http(s)` link in a rendered message gains:

- A **site favicon** before the link text, loaded from DuckDuckGo's icon service (`icons.duckduckgo.com`) — one request per domain, then browser-cached. Requests are lazy and referrer-free.
- A **hostname tooltip** on hover, so you can see where a link goes before following it.

Failures fail soft: a 404 or an offline moment removes the placeholder instead of leaving a broken-image glyph mid-sentence.

**Setting:** Settings → Curtis.ai → Chat UI → **Link favicons** (on by default). Turn it off and chat rendering makes zero network requests — nothing is fetched for display.

## Vault paths in prose

When assistant text mentions a note by path — `Projects/Ideas.md` — and that path exists in your vault, it becomes a tappable link:

- **Click** opens the note.
- **Hover** shows Obsidian's native page-preview popover.

Detection is deliberately generous and then verified: a scanner proposes plausible path-shaped spans, each is checked against the real vault index, and anything unknown or ambiguous stays plain text. Already-linked text (markdown links, wikilinks), code, and tool output are never rewritten — only prose references linkify, and a false positive costs one lookup, never a wrong link.

## Privacy

| What | Network effect |
|---|---|
| **Favicons off** | None — rendering is fully local |
| **Favicons on** (the default) | One request per external-link domain to `icons.duckduckgo.com` |
| **Vault-path links** | None — resolution is entirely against your local vault index |
