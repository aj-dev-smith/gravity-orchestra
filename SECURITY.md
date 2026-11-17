# Security

Orchestrion is a static site: HTML, JavaScript and assets served from a CDN. There is no
backend, no accounts and no server-side storage. Songs travel inside share links, and MIDI files
are parsed in your own browser.

Worth reporting: anything that lets a crafted share link, MIDI file or URL flag run script or do
something harmful in a visitor's browser, and anything in the build that ships something it
shouldn't.

## How to report

Please **don't open a public issue.** Use GitHub's private vulnerability reporting: the
**Security** tab, then **Report a vulnerability**
([direct link](https://github.com/aj-dev-smith/orchestrion/security/advisories/new)).

This is a one-person project, so responses are best-effort, but security reports go first.
