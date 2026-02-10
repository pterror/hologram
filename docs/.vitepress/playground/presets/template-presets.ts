import { DEFAULT_TEMPLATE } from '../template-evaluator'
import type { PlaygroundEntity, PlaygroundHistoryMessage } from '../template-evaluator'

export interface TemplatePreset {
  name: string
  template: string
  entities: PlaygroundEntity[]
  others: PlaygroundEntity[]
  memories: Record<number, string[]>
  history: PlaygroundHistoryMessage[]
  freeform: boolean
}

export const templatePresets: TemplatePreset[] = [
  {
    name: 'Default Template',
    template: DEFAULT_TEMPLATE,
    entities: [
      { id: 1, name: 'Aria', factsText: 'is a character\nhas silver hair\nis friendly and curious' },
    ],
    others: [
      { id: 100, name: 'user', factsText: 'is an adventurer\ncarries a sword' },
    ],
    memories: {},
    history: [
      { author: 'User', content: 'Hello, who are you?', role: 'user' },
      { author: 'Aria', content: 'I\'m Aria! Nice to meet you.', role: 'assistant' },
      { author: 'User', content: 'What do you like to do?', role: 'user' },
    ],
    freeform: false,
  },
  {
    name: 'Multi-Character',
    template: DEFAULT_TEMPLATE,
    entities: [
      { id: 1, name: 'Aria', factsText: 'is a character\nhas silver hair\nis friendly' },
      { id: 2, name: 'Kael', factsText: 'is a character\nis a stoic warrior\nprotects Aria' },
    ],
    others: [
      { id: 100, name: 'user', factsText: 'is an adventurer' },
    ],
    memories: {},
    history: [
      { author: 'User', content: 'We need to cross the bridge. Is it safe?', role: 'user' },
    ],
    freeform: false,
  },
  {
    name: 'Custom Template',
    template: `{#- Simple custom template -#}
{% block definitions %}
You are {{ entities[0].name }}, a character in an interactive story.

Your traits:
{% for fact in entities[0].facts %}
- {{ fact }}
{% endfor %}

{% if others | length > 0 %}
Other characters present:
{% for entity in others %}
- {{ entity.name }}: {{ entity.facts | join(", ") }}
{% endfor %}
{% endif %}
{% endblock %}

{% block history %}
{% for msg in history %}
{% call send_as("assistant" if responders[msg.entity_id] else "user") -%}
  {{ msg.author }}: {{ msg.content }}
{%- endcall %}
{% endfor %}
{% endblock %}`,
    entities: [
      { id: 1, name: 'Sage', factsText: 'is a wise old wizard\nspecializes in fire magic\nlives in a tower' },
    ],
    others: [
      { id: 100, name: 'user', factsText: 'is a young apprentice' },
    ],
    memories: {},
    history: [
      { author: 'User', content: 'Master, teach me a spell!', role: 'user' },
    ],
    freeform: false,
  },
  {
    name: 'Template with Memories',
    template: DEFAULT_TEMPLATE,
    entities: [
      { id: 1, name: 'Aria', factsText: 'is a character\nhas silver hair\nlikes tea' },
    ],
    others: [],
    memories: {
      1: [
        'User mentioned they like cats',
        'Had a conversation about the market yesterday',
        'User is looking for a rare book',
      ],
    },
    history: [
      { author: 'User', content: 'Did you find that book I was looking for?', role: 'user' },
    ],
    freeform: false,
  },
  {
    name: 'Freeform Mode',
    template: DEFAULT_TEMPLATE,
    entities: [
      { id: 1, name: 'Aria', factsText: 'is a cheerful bard\nplays the lute' },
      { id: 2, name: 'Kael', factsText: 'is a grumpy dwarf\nlikes ale' },
      { id: 3, name: 'Zara', factsText: 'is an elven ranger\nspeaks softly' },
    ],
    others: [
      { id: 100, name: 'user', factsText: 'is the party leader' },
    ],
    memories: {},
    history: [
      { author: 'User', content: 'Let\'s set up camp for the night.', role: 'user' },
    ],
    freeform: true,
  },
]
