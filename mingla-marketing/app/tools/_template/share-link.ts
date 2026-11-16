// SHARE-SEMANTIC-ROLE:content-transport

// #4452 §6.7: "Share this report" hands the report's own address to the
// device share sheet, or copies it where there is none. A plain transport: the
// caller passes the prepared title and url.
export async function shareLink(title: string, url: string): Promise<'shared' | 'copied'> {
  if (typeof navigator.share === 'function') {
    // SHARE-CONTENT-CALL:transport
    await navigator.share({ title, url })
    return 'shared'
  }
  await navigator.clipboard.writeText(url)
  return 'copied'
}
