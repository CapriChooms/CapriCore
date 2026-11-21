// SPDX-License-Identifier: GPL-3.0-only
import { INTERFACE_LOCALES } from './interface-translations.mjs';

const labels = {
  menuTitle: 'Guides and FAQ',
  title: 'FAQ',
  description: 'Answers about setup, models, voice, privacy and more.',
  searchLabel: 'Search FAQ',
  empty: 'No matching questions.',
  back: 'Back to help',
  close: 'Close help',
  unavailable: 'Could not open this destination.',
};

const settings = (section, label) => ({ section, label });
const external = (link, label) => ({ link, label });
const models = settings('models', 'Language model');
const api = settings('api', 'API connections');
const updates = settings('updates', 'Updates');
const microphone = settings('microphone', 'Voice input');
const replies = settings('voice', 'Spoken replies');
const music = settings('music', 'Music listening');
const report = settings('bug', 'Report a bug');
const support = settings('support', 'Support the author');
const releases = external('releases', 'Official releases');
const website = external('website', 'Official website');
const github = external('github', 'Source code on GitHub');
const discord = external('discord', 'Discord');

// Adapted from the Discord community FAQ collected in CapriPosts. Keep routes
// and link identifiers separate from translated prose.
const topics = [
  [
    'Download and access',
    [
      [
        'download',
        'Where can I download Capri?',
        'Get CapriSetup from the official website or the latest public release on GitHub.',
        releases,
        website,
      ],
      [
        'free',
        'Is Capri free?',
        'The public version of Capri is free and open source. Supporting the project is optional. Cloud providers may charge for their services.',
        github,
      ],
      [
        'install',
        'How do I install Capri?',
        'Run CapriSetup and follow the wizard to choose a model and optional components. Setup installs the runtimes it needs, including Python and Node.js.',
        releases,
      ],
      [
        'installer-zip',
        'What is the difference between the installer and the ZIP?',
        'CapriSetup runs the wizard directly. To install from the source ZIP, extract it first, then run Install Capri.cmd from the extracted folder.',
        releases,
      ],
      [
        'github-404',
        'Why does a GitHub link show a 404 error?',
        'Older links may lead to a private early-access repository. Use the public source page below. If you need access to a private release, check whether you accepted the GitHub invitation.',
        github,
        discord,
      ],
      [
        'preview',
        'How do I get experimental builds?',
        'Experimental builds for supporters appear in Updates after you connect a GitHub account with access to the private repository. Request access through the community and accept the invitation.',
        updates,
        support,
        discord,
      ],
    ],
  ],
  [
    'Models and performance',
    [
      [
        'key',
        'Do I need an API key?',
        'Local models run on your computer without an API key. A key is needed only if your chosen API provider requires one.',
        models,
        api,
      ],
      [
        'local-api',
        'What is the difference between a local model and an API?',
        'A local model uses your CPU, GPU and memory. A cloud API sends requests to the selected provider, needs an internet connection and may cost money.',
        models,
        api,
      ],
      [
        'which-model',
        'Which model should I choose?',
        'Start with the installer recommendation. Smaller models generally respond faster and use less memory. Check model support for images and tools if you need those features.',
        models,
      ],
      [
        'own-model',
        'Can I use my own model or API?',
        'Capri supports compatible local GGUF models and API connections. Enter the provider URL, the exact model ID and the key if required. Image and tool support depends on the model and provider.',
        models,
        api,
      ],
      [
        'slow',
        'Why is Capri slow or using so much RAM or VRAM?',
        'Try a smaller local model or a shorter context window. You can also close other demanding apps or use a cloud API. CPU-only generation can take longer.',
        models,
        api,
      ],
      [
        'gaming',
        'Can I use Capri while gaming?',
        'Yes. Local generation and speech may compete with the game for CPU, GPU and memory. If performance drops, try a smaller model or a cloud API for chat.',
        models,
        api,
      ],
      [
        'requirements',
        'What are the minimum requirements?',
        'The smallest supported setup uses 64-bit Windows 10 22H2 or Windows 11 and 8 GiB of system RAM. Check the installer estimates for the model and speech components you choose.',
      ],
      [
        'amd-intel',
        'Does Capri work with AMD or Intel graphics?',
        'It depends on the graphics device, driver and model. Check the model device options in the app. Some voice and model configurations run on the CPU.',
        models,
      ],
    ],
  ],
  [
    'Updates and installation issues',
    [
      [
        'update',
        'How do I update Capri?',
        'Check Updates or run the latest installer. Select the existing Capri installation folder so the installer updates it in place.',
        updates,
        releases,
      ],
      [
        'data-update',
        'Will updating delete my conversations and models?',
        'Updating the existing installation preserves settings, conversations and compatible downloaded models. Back up anything you want to keep before installing an experimental build.',
        updates,
      ],
      [
        'setup-time',
        'Why is installation taking so long?',
        'Setup may need to download large model files and dependencies. Check the current stage, transfer progress and available disk space.',
      ],
      [
        'setup-failed',
        'What if installation or voice dependencies fail?',
        'Read the installer error, check free disk space and your connection, then retry. If it keeps failing, save the installer diagnostic report and review it before attaching it to a bug report.',
        report,
      ],
    ],
  ],
  [
    'Voice',
    [
      [
        'talk',
        'How do I talk to Capri?',
        'Enable Voice input, select a microphone and make sure Windows allows microphone access. Use the microphone beside the message field to speak now, or enable the wake phrase in the toolbar.',
        microphone,
      ],
      [
        'silent',
        'Why is Capri not speaking?',
        'Enable Spoken replies, check that the speaker is unmuted, and select a compatible installed voice or configure a voice API. Microphone input and spoken replies have separate controls.',
        replies,
      ],
      [
        'text-only',
        'Can I use Capri without a microphone or spoken replies?',
        'Yes. Type in the message field and press Enter. The message field and conversation history work with voice input and spoken replies turned off.',
        microphone,
        replies,
      ],
    ],
  ],
  [
    'Safety and supported platforms',
    [
      [
        'windows-warning',
        'Why does Windows warn about the installer?',
        'Windows can show an unknown publisher because CapriSetup is unsigned. Use the official release, compare its SHA-256 checksum and scan the file. Report any detection by its exact name.',
        releases,
        github,
        report,
      ],
      [
        'platforms',
        'Is there an official mobile, macOS or Linux version?',
        'The public build is for Windows. A mobile release is not planned for the near future. There is no confirmed release date for macOS or Linux.',
        website,
      ],
      [
        'windows-ten',
        'Does Capri work on Windows 10?',
        'The supported installer baseline is Windows 10 22H2 or Windows 11, both 64-bit.',
      ],
      [
        'computer-access',
        'Do I need to give Capri full computer access?',
        'Full computer access is optional. Turn it on only for tasks that need it. Press Esc during an active session to stop computer control, or revoke the permission in Settings.',
        settings('computer', 'Computer control'),
      ],
      [
        'anti-cheat',
        'Can I use Capri with games that use anti-cheat?',
        'Compatibility depends on the game and its anti-cheat system. Check the game rules before enabling computer control or overlays during play.',
        settings('computer', 'Computer control'),
      ],
    ],
  ],
  [
    'Music and languages',
    [
      [
        'listen',
        'How do I make Capri listen to music?',
        'Turn on Music listening. Capri can detect rhythm from system audio and animate to the beat. Choose a different audio input or playback device under Audio if needed.',
        music,
        settings('audio', 'Audio'),
      ],
      [
        'music-sources',
        'Does Music listening only work with Spotify?',
        'Music listening uses the selected audio device, so it works with any app playing through it. The separate Spotify and YouTube Music skills control playback in those services.',
        music,
        settings('spotify', 'Spotify'),
        settings('youtube-music', 'YouTube Music'),
      ],
      [
        'languages',
        'Can I use Capri in other languages?',
        'Choose the interface and conversation languages separately. Speech recognition and spoken voice options depend on the language and the installed speech components.',
        settings('languages', 'Languages'),
        microphone,
        replies,
      ],
    ],
  ],
  [
    'Uninstallation, reports and support',
    [
      [
        'uninstall',
        'How do I uninstall Capri?',
        'Run uninstall.exe from the original Capri installation folder or find Capri in Windows Installed apps. Select which components to remove, including downloaded models and personal data if desired.',
      ],
      [
        'bug',
        'Where can I report a bug?',
        'Open Report a bug from the toolbar or Settings. Include your Capri version, steps to reproduce and the exact error. Review diagnostic attachments before sharing them. You can also check existing GitHub issues.',
        report,
        external('issue-list', 'GitHub issues'),
      ],
      [
        'support',
        'How can I support Capri?',
        'The Support the author page links to Boosty and Lava.top. Support is optional and helps fund development.',
        support,
        external('boosty', 'Boosty'),
        external('lava', 'Lava.top'),
      ],
    ],
  ],
];

export const FAQ_KEYS = [
  ...new Set([
    ...Object.values(labels),
    ...topics.flatMap(([title, items]) => [
      title,
      ...items.flatMap(([, question, answer, ...actions]) => [
        question,
        answer,
        ...actions.map(({ label }) => label),
      ]),
    ]),
  ]),
];

export function faqContent(ui) {
  return {
    ...Object.fromEntries(Object.entries(labels).map(([key, label]) => [key, ui.text(label)])),
    lang: ui.language,
    direction: INTERFACE_LOCALES.find(({ id }) => id === ui.language)?.direction ?? 'ltr',
    groups: topics.map(([title, items]) => ({
      title: ui.text(title),
      items: items.map(([id, question, answer, ...actions]) => ({
        id,
        question: ui.text(question),
        answer: ui.text(answer),
        actions: actions.map((action) => ({ ...action, label: ui.text(action.label) })),
      })),
    })),
  };
}
