# Local output headroom follows the current turn

The model catalogue retains an 8,192-token output allowance so that Thinking can solve longer tasks. Previously the native foreground context check could reserve that allowance, or the upstream reserve floor, even when an ordinary reply would generate at most 2,048 tokens. The earlier reserve exception covered only Capri's Qwen aliases and did not cover the shipped Gemma and Ministral profiles.

Capri now derives an ephemeral model for each foreground request: up to 2,048 output tokens for an ordinary reply and up to 8,192 for Thinking. The budget respects smaller explicit model-output and generation limits, and remains within half the effective context window. Both the SDK model limit and Ollama's per-request `num_predict` use that value, including models without a native reasoning switch. The prepared compaction settings receive the same transient model rather than reading the stored maximum as this turn's requirement.

The policy applies only to Capri's local Qwen aliases, the shipped Gemma and Ministral profiles, and managed Hugging Face imports. Other agents, external API profiles and unrecognized local models retain their existing behavior. Stored provider definitions, context sizes, generation settings, personality, memory and history are unchanged. Thinking remains a per-request choice; switching it does not reload model weights.

## Before and after

A private comparison reconstructed the prior, checksum-verified native settings module and ran both versions against the same 30 synthetic cases: three local model families, five context sizes and ordinary/Thinking modes. It also used the native prompt-pressure decision function. It did not load a language model or modify an installed profile.

For a 32,768-token window and a fixed 25,452-token prompt estimate:

| Mode                      | Previous output reserve | Current output reserve | Prompt budget | Native precheck |
| ------------------------- | ----------------------: | ---------------------: | ------------: | --------------- |
| Ordinary, previous policy |                   8,192 |                      — |        24,576 | Compact         |
| Ordinary, current policy  |                       — |                  2,048 |        30,720 | Fits            |
| Thinking, current policy  |                       — |                  8,192 |        24,576 | Compact         |

The ordinary case recovers 6,144 prompt tokens and reduces its unused reserve by 75%. Twelve of the 30 synthetic comparisons avoided a compaction that the previous settings requested. These are context-budget and routing results, not measured language-model latency, throughput or RAM savings. Genuinely oversized history still compacts, and the existing context guard remains active.

Regression checks cover every shipped Qwen size, Gemma, Ministral, a managed Hugging Face identifier, smaller explicit limits, unsupported profiles and unchanged original configuration. Real loopback Ollama requests verify the transmitted ordinary, Thinking and smaller output limits. Compatibility checks reconstruct fresh dependencies and earlier reviewed patch versions, validate their checksums, and verify idempotent application.
