# Skill Store Community Market Design

## Goal

Make the `lobe-skill-store` builtin tool work with this project's self-hosted community market without changing the Skill Store UI tabs or market list UI.

## Scope

- Keep the existing Skill Store modal UI unchanged.
- Keep `importSkill` URL, GitHub, and zip import behavior unchanged.
- Change server-side `searchSkill` to read from `CommunityService.getSkillList`.
- Change server-side `importFromMarket` to install through `CommunityService.installSkill`.
- Preserve the builtin tool response shape expected by `SkillStoreExecutionRuntime`.

## Search Mapping

The builtin tool accepts official Skill Store search params:

- `q`
- `category`
- `page`
- `pageSize`
- `sort`
- `order`
- `locale`

The community market accepts:

- `keyword`
- `category`
- `page`
- `pageSize`
- `sortBy`

Mapping:

- `q` -> `keyword`
- `category` -> `category`
- `page` -> `page || 1`
- `pageSize` -> `pageSize || 20`
- `sort: installCount` -> `sortBy: installCount`
- `sort: updatedAt` or `createdAt` -> `sortBy: updatedAt`
- all other `sort` values -> `sortBy: recommended`
- `locale` and `order` are ignored because the community market does not support them.

## Install Mapping

`importFromMarket(identifier)` must call `CommunityService.installSkill(identifier)`. This preserves current project behavior: copying the market skill into the user's local skill library, generating the zip package, recording market source metadata, and incrementing install count.

## Tests

Add focused Vitest coverage for the server runtime service:

- `searchSkill` maps official tool params to community market params and returns `{ items, page, pageSize, total }`.
- `importFromMarket` delegates to `CommunityService.installSkill` and returns the standard import result.
