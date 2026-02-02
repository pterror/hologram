export interface FactPreset {
  name: string
  facts: string
  context: {
    mentioned: boolean
    replied: boolean
    is_forward: boolean
    is_self: boolean
    content: string
    author: string
    name: string
    chars: string
    response_ms: number
    idle_ms: number
    retry_ms: number
  }
}

export const factPresets: FactPreset[] = [
  {
    name: 'Basic Character',
    facts: `is a character
has silver hair
has blue eyes
is friendly and curious
likes exploring old ruins`,
    context: {
      mentioned: true,
      replied: false,
      is_forward: false,
      is_self: false,
      content: 'Hello there!',
      author: 'User',
      name: 'Aria',
      chars: 'Aria',
      response_ms: 0,
      idle_ms: 0,
      retry_ms: 0,
    },
  },
  {
    name: 'Conditional Response',
    facts: `is a guard at the castle gate
is suspicious of strangers
$if mentioned: $respond
$if content.includes("password"): knows the password is "moonlight"
$if time.is_night: is extra vigilant`,
    context: {
      mentioned: true,
      replied: false,
      is_forward: false,
      is_self: false,
      content: 'What is the password?',
      author: 'Traveler',
      name: 'Guard',
      chars: 'Guard',
      response_ms: 0,
      idle_ms: 0,
      retry_ms: 0,
    },
  },
  {
    name: 'Self Context',
    facts: `is a shapeshifter
health: 80
fox_tf: 0.7
mood: playful
$if self.fox_tf >= 0.5: has full fox ears and tail
$if self.fox_tf < 0.5: looks mostly human
$if self.health < 50: is visibly wounded
$if self.mood == "playful": is in a teasing mood`,
    context: {
      mentioned: false,
      replied: false,
      is_forward: false,
      is_self: false,
      content: 'How are you feeling?',
      author: 'User',
      name: 'Kira',
      chars: 'Kira',
      response_ms: 0,
      idle_ms: 0,
      retry_ms: 0,
    },
  },
  {
    name: 'Content Matching',
    facts: `is a bartender at the tavern
$if content.includes("drink"): offers the house special
$if content.includes("fight"): $respond false
$if content.match("h[ea]l+o"): waves hello cheerfully
$# This is a comment — it won't appear in evaluated facts
$respond`,
    context: {
      mentioned: false,
      replied: false,
      is_forward: false,
      is_self: false,
      content: 'Can I get a drink?',
      author: 'Patron',
      name: 'Barkeep',
      chars: 'Barkeep',
      response_ms: 0,
      idle_ms: 0,
      retry_ms: 0,
    },
  },
  {
    name: 'Rate Limiting',
    facts: `is an ambient NPC
$if response_ms > 30000: $respond
$if random() < 0.1: $respond
$if mentioned: $respond
$context chars < 8000`,
    context: {
      mentioned: false,
      replied: false,
      is_forward: false,
      is_self: false,
      content: 'Just walking around.',
      author: 'User',
      name: 'Villager',
      chars: 'Villager',
      response_ms: 60000,
      idle_ms: 5000,
      retry_ms: 0,
    },
  },
  {
    name: 'Streaming + Multi-char',
    facts: `is the narrator of the story
$stream full
$model google:gemini-2.0-flash
$freeform
$memory channel
$strip "</blockquote>"
$avatar https://example.com/narrator.png
$respond`,
    context: {
      mentioned: false,
      replied: false,
      is_forward: false,
      is_self: false,
      content: 'What happens next?',
      author: 'Player',
      name: 'Narrator',
      chars: 'Narrator, Hero, Villain',
      response_ms: 0,
      idle_ms: 0,
      retry_ms: 0,
    },
  },
]
