/** A failure explained to the user: the CLI prints the message and exits with code 1. */
export class AtlasError extends Error {}

/** GitHub answers no more for now: the rate limit, a rejected token, no network. A scan stops there. */
export class GitHubUnavailable extends AtlasError {}
