// #4636 live block `blogStories` — the blog index (featured story, category
// tabs, story grid, load more). The stories stay live (lib/blog/data.ts, the
// 5-minute `blog` cache, R7); the editor sets the headline and lead. The view
// is components/blog/blog-index.tsx, unchanged, also rendered by /blog.
import { BlogIndexView } from '@/components/blog/blog-index'
import { getBlogIndex, type BlogIndex } from '@/lib/blog/data'
import { Em, type BlockProps } from './shared'

export interface BlogStoriesContent {
  title: string
  lede: string
}

export async function BlogStoriesBlock({ content, index, page = 1 }: BlockProps<BlogStoriesContent> & { index?: BlogIndex; page?: number }) {
  const data = index ?? (await getBlogIndex(null, page))
  return (
    <BlogIndexView
      index={data}
      page={page}
      category={null}
      heading={content.title.replace(/\*/g, '')}
      lede={content.lede}
      basePath="/blog"
      title={<Em text={content.title} />}
    />
  )
}
