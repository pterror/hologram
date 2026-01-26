import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Hologram',
  description: 'Discord RP bot with smart context/memory/world management',
  base: '/hologram/',

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/guide/' },
          { text: 'Installation', link: '/guide/installation' },
          { text: 'Configuration', link: '/guide/configuration' },
          { text: 'API Keys (BYOK)', link: '/guide/keys' },
        ]
      },
      {
        text: 'Features',
        items: [
          { text: 'Characters', link: '/guide/characters' },
          { text: 'Scenes', link: '/guide/scenes' },
          { text: 'Chronicle', link: '/guide/chronicle' },
          { text: 'World Building', link: '/guide/world' },
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/pterror/hologram' }
    ],

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/pterror/hologram/edit/master/docs/:path',
      text: 'Edit this page on GitHub'
    },

    footer: {
      message: 'Released under the MIT License.',
    }
  }
})
