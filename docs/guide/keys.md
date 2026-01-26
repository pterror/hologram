# API Keys (BYOK)

Hologram supports Bring Your Own Key (BYOK) - use your own API keys for LLM and image generation providers.

## Why Use Your Own Keys?

- **No quota limits** - Bypass bot-wide usage quotas
- **Provider choice** - Use any supported provider
- **Cost control** - Pay only for your usage
- **Privacy** - Your requests go directly to the provider

## Quick Start

```
/keys add google user     # Add your personal Google API key
/keys test google         # Verify it works
/keys status              # See which keys are active
```

## Commands

| Command | Description |
|---------|-------------|
| `/keys add <provider> <scope>` | Add or update an API key |
| `/keys list [scope]` | View configured keys |
| `/keys remove <provider> <scope>` | Delete a key |
| `/keys test <provider>` | Validate the active key |
| `/keys status` | Show BYOK status and active keys |

## Scopes

### Personal Keys (`user`)
- Only you can use the key
- Works in any server
- Highest priority in resolution

### Server Keys (`guild`)
- Anyone in the server can use it
- Requires **Manage Server** permission to set
- Falls back if no personal key exists

## Supported Providers

### LLM Providers
| Provider | Key Name | Description |
|----------|----------|-------------|
| `google` | Google API Key | For Gemini models |
| `anthropic` | Anthropic API Key | For Claude models |
| `openai` | OpenAI API Key | For GPT models |

### Image Providers
| Provider | Key Name | Description |
|----------|----------|-------------|
| `runcomfy` | RunComfy API Key | Managed ComfyUI |
| `runcomfy-serverless` | RunComfy Serverless Key | Serverless deployment |
| `saladcloud` | SaladCloud API Key | SaladCloud hosting |
| `runpod` | RunPod API Key | RunPod hosting |

## Key Resolution Order

When you send a message, Hologram looks for keys in this order:

1. **Your personal key** for the provider
2. **Server key** for the provider (if in a server)
3. **Bot's default key** (environment variable)

Invalid keys are automatically skipped.

## Examples

### Add a Personal Google Key
```
/keys add google user
```
A modal opens for secure key entry. Your key is encrypted and stored.

### Add a Server-Wide Anthropic Key
```
/keys add anthropic guild
```
Requires Manage Server permission. All server members can use this key.

### Check What's Active
```
/keys status
```
Shows which key source is active for each provider (personal, server, or env).

### Test Your Key
```
/keys test google
```
Validates the key against the provider's API.

### Remove a Key
```
/keys remove google user
```
Deletes your personal key. Falls back to server key or bot default.

## Security

- **Encrypted storage** - Keys are encrypted at rest with AES-256-GCM
- **Modal input** - Keys entered via Discord modal, never visible in chat
- **No display** - Keys are never shown after storage
- **Permission checks** - Server keys require admin permissions

## Quota Integration

When using your own keys:
- Usage is still tracked (for analytics)
- Bot quotas may not apply (operator-configured)
- Your provider's rate limits still apply

Check your usage with `/quota status`.

## Troubleshooting

### "BYOK is not enabled"
The bot operator hasn't configured BYOK. Ask them to set `BYOK_MASTER_KEY`.

### "Key is invalid"
The key was rejected by the provider. Check:
- Key is correct (no extra spaces)
- Key has required permissions/scopes
- Account is in good standing

### "No API key configured"
No key found in the resolution chain. Add one with `/keys add`.

### Key not being used
Check `/keys status` to see which key is active. Your personal key always takes priority over server keys.
