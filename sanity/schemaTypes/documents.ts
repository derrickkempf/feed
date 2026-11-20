import {defineArrayMember, defineField, defineType} from 'sanity'
import {CalendarIcon} from '@sanity/icons/Calendar'
import {DocumentsIcon} from '@sanity/icons/Documents'
import {UserIcon} from '@sanity/icons/User'
import {CogIcon} from '@sanity/icons/Cog'
import {StarIcon} from '@sanity/icons/Star'
import {ImageIcon} from '@sanity/icons/Image'
import {feedItemTypes} from './blocks'

/** One entry in the daily feed. */
export const day = defineType({
  name: 'day',
  title: 'Day',
  type: 'document',
  icon: CalendarIcon,
  fields: [
    defineField({
      name: 'date',
      type: 'date',
      initialValue: () => new Date().toISOString().slice(0, 10),
      validation: (r) =>
        r.required().custom(async (date, ctx) => {
          if (!date) return true
          const id = ctx.document?._id.replace(/^drafts\./, '')
          const client = ctx.getClient({apiVersion: '2026-11-01'})
          const n = await client.fetch(
            'count(*[_type == "day" && date == $date && !(_id in [$id, "drafts." + $id])])',
            {date, id},
          )
          return n === 0 || 'There is already a day for this date — add to that one instead.'
        }),
    }),
    defineField({
      name: 'items',
      title: 'On this day',
      description: 'Images and blocks. Drag to reorder; order controls auto-placement.',
      type: 'array',
      of: feedItemTypes.map((t) => defineArrayMember(t)),
    }),
  ],
  orderings: [{title: 'Newest first', name: 'dateDesc', by: [{field: 'date', direction: 'desc'}]}],
  preview: {
    select: {date: 'date', items: 'items', media: 'items.0.image'},
    prepare: ({date, items, media}) => ({
      title: date,
      subtitle: `${(items || []).length} item${(items || []).length === 1 ? '' : 's'}`,
      media,
    }),
  },
})

const pageImage = defineArrayMember({
  name: 'pageImage',
  title: 'Image',
  type: 'object',
  icon: ImageIcon,
  fields: [
    defineField({name: 'image', type: 'image', options: {hotspot: true}, validation: (r) => r.required()}),
    defineField({name: 'alt', type: 'string'}),
    defineField({
      name: 'mode',
      type: 'string',
      initialValue: 'regular',
      description: 'Consecutive “gallery” or “slider” images are grouped together.',
      options: {list: ['regular', 'wide', 'full', 'gallery', 'slider'], layout: 'radio', direction: 'horizontal'},
    }),
  ],
  preview: {select: {media: 'image', title: 'alt', mode: 'mode'}, prepare: ({media, title, mode}) => ({media, title: title || 'Image', subtitle: mode})},
})

/** Rich body used by Works pages and About. */
export const richBody = defineType({
  name: 'richBody',
  title: 'Body',
  type: 'array',
  of: [
    defineArrayMember({
      type: 'block',
      styles: [
        {title: 'Normal', value: 'normal'},
        {title: 'H2', value: 'h2'},
        {title: 'H3', value: 'h3'},
        {title: 'H4', value: 'h4'},
        {title: 'H5', value: 'h5'},
        {title: 'Quote', value: 'blockquote'},
        {title: 'Big quote', value: 'bigquote'},
      ],
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
    defineArrayMember({
      name: 'bodyImage',
      title: 'Image',
      type: 'object',
      icon: ImageIcon,
      fields: [
        defineField({name: 'image', type: 'image', options: {hotspot: true}, validation: (r) => r.required()}),
        defineField({name: 'alt', type: 'string'}),
        defineField({
          name: 'float',
          type: 'string',
          initialValue: 'inline',
          options: {
            list: [
              {title: 'Inline', value: 'inline'},
              {title: 'Left, text wraps', value: 'left'},
              {title: 'Right, text wraps', value: 'right'},
            ],
            layout: 'radio',
            direction: 'horizontal',
          },
        }),
      ],
      preview: {select: {media: 'image', float: 'float'}, prepare: ({media, float}) => ({media, title: `Image (${float || 'inline'})`})},
    }),
    defineArrayMember({
      name: 'pullQuote',
      title: 'Pull quote',
      type: 'object',
      fields: [
        defineField({name: 'text', type: 'text', rows: 3}),
        defineField({
          name: 'side',
          type: 'string',
          initialValue: 'right',
          options: {list: ['left', 'right'], layout: 'radio', direction: 'horizontal'},
        }),
        defineField({name: 'big', type: 'boolean', initialValue: false}),
      ],
      preview: {select: {title: 'text', side: 'side'}, prepare: ({title, side}) => ({title, subtitle: `Pull quote · ${side}`})},
    }),
  ],
})

/** Project / post pages listed under Works. */
export const work = defineType({
  name: 'work',
  title: 'Work',
  type: 'document',
  icon: DocumentsIcon,
  fields: [
    defineField({name: 'title', type: 'string', validation: (r) => r.required()}),
    defineField({
      name: 'slug',
      type: 'slug',
      options: {source: 'title', maxLength: 48},
      validation: (r) => r.required(),
    }),
    defineField({name: 'subtitle', type: 'string', description: 'Year — medium, edition…'}),
    defineField({
      name: 'publishedAt',
      type: 'datetime',
      description: 'Works are ordered oldest → newest by this date.',
      initialValue: () => new Date().toISOString(),
    }),
    defineField({name: 'excerpt', type: 'text', rows: 2, description: 'Optional. Defaults to the first paragraph.'}),
    defineField({name: 'body', type: 'richBody'}),
    defineField({
      name: 'gallery',
      title: 'Images',
      description: 'Shown below the text. The first image is the cover on the Works grid.',
      type: 'array',
      of: [pageImage],
    }),
  ],
  orderings: [{title: 'Published', name: 'published', by: [{field: 'publishedAt', direction: 'asc'}]}],
  preview: {select: {title: 'title', subtitle: 'subtitle', media: 'gallery.0.image'}},
})

/** Reusable card that can be dropped into any day. */
export const snippet = defineType({
  name: 'snippet',
  title: 'Saved card',
  type: 'document',
  icon: StarIcon,
  fields: [
    defineField({name: 'name', type: 'string', validation: (r) => r.required()}),
    defineField({
      name: 'content',
      type: 'array',
      validation: (r) => r.required().length(1),
      of: feedItemTypes.filter((t) => t.type !== 'cardBlock').map((t) => defineArrayMember(t)),
    }),
  ],
  preview: {select: {title: 'name', media: 'content.0.image'}},
})

export const about = defineType({
  name: 'about',
  title: 'About',
  type: 'document',
  icon: UserIcon,
  fields: [
    defineField({name: 'photo', type: 'image', options: {hotspot: true}}),
    defineField({name: 'body', type: 'richBody'}),
  ],
  preview: {prepare: () => ({title: 'About'})},
})

export const settings = defineType({
  name: 'settings',
  title: 'Site settings',
  type: 'document',
  icon: CogIcon,
  fields: [
    defineField({name: 'title', title: 'Wordmark', type: 'string', initialValue: 'Derrick Kempf'}),
    defineField({name: 'tagline', type: 'string', initialValue: 'Artist & Brand Identity Designer'}),
    defineField({
      name: 'heroLines',
      title: 'Feed headline',
      type: 'array',
      of: [{type: 'string'}],
      initialValue: ['Art feed'],
    }),
    defineField({name: 'description', title: 'SEO description', type: 'string', initialValue: "A daily record of what I'm making."}),
    defineField({name: 'ogImage', title: 'Share image', type: 'image'}),
    defineField({
      name: 'footerLink',
      type: 'object',
      fields: [
        defineField({name: 'label', type: 'string', initialValue: 'MA:DE'}),
        defineField({name: 'url', type: 'url', initialValue: 'https://madeartes.com'}),
      ],
    }),
    defineField({
      name: 'fourthwall',
      title: 'Fourthwall shop',
      type: 'object',
      options: {collapsible: true},
      fields: [
        defineField({name: 'shopUrl', type: 'url', initialValue: 'https://dewd.cool/'}),
        defineField({
          name: 'storefrontToken',
          type: 'string',
          description: 'Public storefront token (ptkn_…) — enables one-click checkout for products with a variant ID.',
        }),
      ],
    }),
  ],
  preview: {prepare: () => ({title: 'Site settings'})},
})
