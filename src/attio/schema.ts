/**
 * Attio attribute slugs, in one place. These must match the attributes actually
 * created in the workspace — see docs/attio-setup.md. Override any of them via env
 * if your workspace uses different slugs.
 */
export const ATTR = {
  companyName: process.env.ATTIO_ATTR_NAME ?? 'name',
  contactEmail: process.env.ATTIO_ATTR_EMAIL ?? 'outreach_email',
  contactName: process.env.ATTIO_ATTR_CONTACT ?? 'outreach_contact',
  assetClass: process.env.ATTIO_ATTR_ASSET_CLASS ?? 'asset_class',
  sequenceStage: process.env.ATTIO_ATTR_STAGE ?? 'sequence_stage',
  sequenceStatus: process.env.ATTIO_ATTR_STATUS ?? 'sequence_status',
  nextTouchAt: process.env.ATTIO_ATTR_NEXT_TOUCH ?? 'next_touch_at',
  lastTouchAt: process.env.ATTIO_ATTR_LAST_TOUCH ?? 'last_touch_at',
  touchCount: process.env.ATTIO_ATTR_TOUCH_COUNT ?? 'touch_count',
  claimedAt: process.env.ATTIO_ATTR_CLAIMED_AT ?? 'claimed_at',
  lastSendKey: process.env.ATTIO_ATTR_SEND_KEY ?? 'last_send_key',
  lastMessageId: process.env.ATTIO_ATTR_MESSAGE_ID ?? 'last_message_id',
  lastSubject: process.env.ATTIO_ATTR_LAST_SUBJECT ?? 'last_subject',
  threadId: process.env.ATTIO_ATTR_THREAD_ID ?? 'thread_id',
  reviewNote: process.env.ATTIO_ATTR_REVIEW_NOTE ?? 'review_note',

  // Sourcing metadata. email_source is enforced at send time for guessed first-touch.
  contactTitle: process.env.ATTIO_ATTR_CONTACT_TITLE ?? 'contact_title',
  /** `published:<url>` or `guessed:<pattern>` — how much to trust the address. */
  emailSource: process.env.ATTIO_ATTR_EMAIL_SOURCE ?? 'email_source',
  website: process.env.ATTIO_ATTR_WEBSITE ?? 'source_website',
  summary: process.env.ATTIO_ATTR_SUMMARY ?? 'company_summary',
  raisedRaw: process.env.ATTIO_ATTR_RAISED ?? 'raised_amount',
  sourceDeck: process.env.ATTIO_ATTR_SOURCE_DECK ?? 'source_deck',
} as const;
