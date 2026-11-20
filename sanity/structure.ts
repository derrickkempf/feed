import type {StructureResolver} from 'sanity/structure'
import {CalendarIcon} from '@sanity/icons/Calendar'
import {CogIcon} from '@sanity/icons/Cog'
import {DocumentsIcon} from '@sanity/icons/Documents'
import {StarIcon} from '@sanity/icons/Star'
import {UserIcon} from '@sanity/icons/User'

export const structure: StructureResolver = (S) =>
  S.list()
    .title('Derrick Kempf')
    .items([
      S.listItem()
        .title('Feed (days)')
        .icon(CalendarIcon)
        .child(S.documentTypeList('day').title('Days').defaultOrdering([{field: 'date', direction: 'desc'}])),
      S.listItem()
        .title('Works')
        .icon(DocumentsIcon)
        .child(S.documentTypeList('work').title('Works').defaultOrdering([{field: 'publishedAt', direction: 'asc'}])),
      S.documentTypeListItem('snippet').title('Saved cards').icon(StarIcon),
      S.divider(),
      S.listItem().title('About').icon(UserIcon).child(S.document().schemaType('about').documentId('about')),
      S.listItem().title('Site settings').icon(CogIcon).child(S.document().schemaType('settings').documentId('settings')),
    ])
