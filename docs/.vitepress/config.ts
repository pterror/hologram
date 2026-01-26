import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Hologram',
  description: 'Discord bot for collaborative worldbuilding and roleplay',
  base: '/hologram/',
  srcExclude: ['archive/**'],

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/' },
      { text: 'Reference', link: '/reference/commands' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/' },
          { text: 'Core Concepts', link: '/guide/concepts' },
          { text: 'Setting Up a Channel', link: '/guide/channel-setup' },
          { text: 'Creating a Persona', link: '/guide/personas' },
        ]
      },
      {
        text: 'Reference',
        items: [
          { text: 'Commands', link: '/reference/commands' },
          { text: 'Triggers', link: '/reference/triggers' },
          { text: 'Fact Patterns', link: '/reference/facts' },
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
