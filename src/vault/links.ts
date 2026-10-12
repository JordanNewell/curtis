// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Note-link conventions — the harness must not prescribe a link style the
// user's vault disagrees with. Obsidian exposes the choice as
// <configDir>/app.json → useMarkdownLinks (absent/false = [[wikilinks]], the
// app default); the config dir comes off Vault#configDir because it can be
// customized. We read it fresh per composition — the file is tiny, sends are
// user-paced, and a session cache would go stale the moment the user flips
// the setting mid-session.
//
// Deliberately duck-typed on the vault (structural { configDir, adapter })
// so the reader and the guidance builder run node-safe under vitest with a
// fake vault — same boundary discipline as src/autocomplete/.

/** The vault's link-style setting, reduced to the one bit the harness needs. */
export interface NoteLinkConventions {
	/** True when the vault uses [[wikilinks]]; false = markdown links. */
	useWikilinks: boolean;
}

/** Read the vault's link preference. A missing or unreadable config file is
 *  Obsidian's default state for a fresh vault — wikilinks on. A malformed
 *  file falls back the same way; never throw into the send path. */
export async function readNoteLinkConventions(vault: {
	configDir: string;
	adapter: { read(path: string): Promise<string> };
}): Promise<NoteLinkConventions> {
	try {
		const raw = await vault.adapter.read(`${vault.configDir}/app.json`);
		const config = JSON.parse(raw) as { useMarkdownLinks?: boolean };
		return { useWikilinks: config.useMarkdownLinks !== true };
	} catch {
		return { useWikilinks: true };
	}
}

/** The compose-time guidance line: format follows the vault's setting, and
 *  the existence rule kills fabricated targets — the failure mode where the
 *  model litters the vault with unresolved links to notes it invented. */
export function noteLinkGuidance(conventions: NoteLinkConventions): string {
	const style = conventions.useWikilinks
		? '[[wikilinks]]'
		: 'markdown links in the form [Title](Title%20name.md) — percent-encode spaces, never [[wikilinks]]';
	return `When writing or editing notes, link related notes with ${style} — but only link notes you know exist: from attachments, search results, memory, or the user's own text. Never invent a link target; unresolved links are clutter. If the right note doesn't exist yet, leave plain text unless the user asked for it to be created.`;
}

/** One-shot convenience for send paths: read the vault, render the guidance. */
export async function noteLinkGuidanceForVault(vault: {
	configDir: string;
	adapter: { read(path: string): Promise<string> };
}): Promise<string> {
	return noteLinkGuidance(await readNoteLinkConventions(vault));
}
