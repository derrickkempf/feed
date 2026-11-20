import {defineArrayMember, defineField, defineType} from 'sanity'
import {ImageIcon} from '@sanity/icons/Image'
import {TextIcon} from '@sanity/icons/Text'
import {BlockquoteIcon} from '@sanity/icons/Blockquote'
import {LinkIcon} from '@sanity/icons/Link'
import {PlayIcon} from '@sanity/icons/Play'
import {DocumentIcon} from '@sanity/icons/Document'
import {StarIcon} from '@sanity/icons/Star'

/**
 * Everything that can sit on a day's canvas in the feed.
 * Each item has an optional `layout` (x / y / width in % of the canvas width).
 * Leave layout empty and the item is auto-placed in the masonry columns.
 */

export const layout = defineType({
  name: 'layout',
  title: 'Position on the canvas',
  type: 'object',
  description:
    'Optional. Leave empty to auto-place. Values are % of the canvas width (desktop only; mobile always stacks).',
  options: {collapsible: true, collapsed: true, columns: 3},
  fields: [
    defineField({name: 'x', title: 'Left (%)', type: 'number', validation: (r) => r.min(0).max(100)}),
    defineField({name: 'y', title: 'Top (%)', type: 'number', validation: (r) => r.min(0)}),
    defineField({name: 'width', title: 'Width (%)', type: 'number', validation: (r) => r.min(10).max(100)}),
  ],
})

export const product = defineType({
  name: 'product',
  title: 'Fourthwall product',
  type: 'object',
  options: {collapsible: true, collapsed: true},
  fields: [
    defineField({name: 'name', type: 'string'}),
    defineField({name: 'price', type: 'string', description: 'Display price, e.g. $40'}),
    defineField({name: 'url', title: 'Product URL', type: 'url'}),
    defineField({
      name: 'variantId',
      type: 'string',
      description: 'Optional. When set, “Buy” creates a Fourthwall cart and goes straight to checkout.',
    }),
  ],
})

/** Minimal rich text used inside feed text/quote blocks (bold, italic, links). */
export const inlineText = defineType({
  name: 'inlineText',
  title: 'Text',
  type: 'array',
  of: [
    defineArrayMember({
      type: 'block',
      styles: [{title: 'Normal', value: 'normal'}],
      lists: [],
      marks: {
        decorators: [
          {title: 'Bold', value: 'strong'},
          {title: 'Italic', value: 'em'},
        ],
        annotations: [
          {
            name: 'link',
            type: 'object',
            title: 'Link',
            fields: [{name: 'href', type: 'url', validation: (r) => r.uri({scheme: ['http', 'https', 'mailto']})}],
          },
        ],
      },
    }),
  ],
})

const layoutField = defineField({name: 'layout', type: 'layout'})

export const feedImage = defineType({
  name: 'feedImage',
  title: 'Image',
  type: 'object',
  icon: ImageIcon,
  fields: [
    defineField({name: 'image', type: 'image', options: {hotspot: true}, validation: (r) => r.required()}),
    defineField({name: 'caption', type: 'string'}),
    defineField({name: 'tags', type: 'array', of: [{type: 'string'}], options: {layout: 'tags'}}),
    defineField({
      name: 'project',
      title: 'Linked work',
      type: 'reference',
      to: [{type: 'work'}],
      description: 'Shows a “View” bar on hover and a project link in the detail view.',
    }),
    defineField({name: 'product', type: 'product'}),
    layoutField,
  ],
  preview: {
    select: {media: 'image', title: 'caption', tags: 'tags'},
    prepare: ({media, title, tags}) => ({
      media,
      title: title || 'Image',
      subtitle: (tags || []).join(', '),
    }),
  },
})

export const textBlock = defineType({
  name: 'textBlock',
  title: 'Text',
  type: 'object',
  icon: TextIcon,
  fields: [defineField({name: 'text', type: 'inlineText'}), layoutField],
  preview: {
    select: {text: 'text'},
    prepare: ({text}) => ({title: blockText(text) || 'Text', subtitle: 'Text'}),
  },
})

export const quoteBlock = defineType({
  name: 'quoteBlock',
  title: 'Quote',
  type: 'object',
  icon: BlockquoteIcon,
  fields: [
    defineField({name: 'text', type: 'inlineText'}),
    defineField({name: 'cite', title: 'Attribution', type: 'string'}),
    layoutField,
  ],
  preview: {
    select: {text: 'text', cite: 'cite'},
    prepare: ({text, cite}) => ({title: `“${blockText(text)}”`, subtitle: cite ? `— ${cite}` : 'Quote'}),
  },
})

export const linkBlock = defineType({
  name: 'linkBlock',
  title: 'Link card',
  type: 'object',
  icon: LinkIcon,
  fields: [
    defineField({name: 'url', type: 'url', validation: (r) => r.required()}),
    defineField({name: 'label', type: 'string'}),
    defineField({name: 'image', title: 'Share image', type: 'image'}),
    layoutField,
  ],
  preview: {select: {title: 'label', subtitle: 'url', media: 'image'}},
})

export const videoBlock = defineType({
  name: 'videoBlock',
  title: 'Video',
  type: 'object',
  icon: PlayIcon,
  fields: [
    defineField({name: 'url', title: 'YouTube or Vimeo URL', type: 'url', validation: (r) => r.required()}),
    layoutField,
  ],
  preview: {select: {title: 'url'}, prepare: ({title}) => ({title, subtitle: 'Video'})},
})

export const postBlock = defineType({
  name: 'postBlock',
  title: 'Work card',
  type: 'object',
  icon: DocumentIcon,
  fields: [
    defineField({name: 'work', type: 'reference', to: [{type: 'work'}], validation: (r) => r.required()}),
    layoutField,
  ],
  preview: {
    select: {title: 'work.title', media: 'work.gallery.0.image'},
    prepare: ({title, media}) => ({title: title || 'Work card', subtitle: 'Work card', media}),
  },
})

export const cardBlock = defineType({
  name: 'cardBlock',
  title: 'Saved card',
  type: 'object',
  icon: StarIcon,
  fields: [
    defineField({name: 'snippet', title: 'Card', type: 'reference', to: [{type: 'snippet'}], validation: (r) => r.required()}),
    layoutField,
  ],
  preview: {
    select: {title: 'snippet.name'},
    prepare: ({title}) => ({title: title || 'Saved card', subtitle: 'Saved card'}),
  },
})

export const feedItemTypes = [
  {type: 'feedImage'},
  {type: 'textBlock'},
  {type: 'quoteBlock'},
  {type: 'linkBlock'},
  {type: 'videoBlock'},
  {type: 'postBlock'},
  {type: 'cardBlock'},
]

function blockText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .map((b: {children?: {text?: string}[]}) => (b.children || []).map((c) => c.text || '').join(''))
    .join(' ')
    .slice(0, 80)
}
