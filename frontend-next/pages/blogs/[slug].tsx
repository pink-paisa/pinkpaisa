import type { GetServerSideProps } from "next";
import BlogDetailPage from "@/pages/BlogDetail";
import SeoHead from "@/components/SeoHead";
import { Blog } from "@/hooks/useBlogs";
import { getSiteUrl, serverFetch } from "@/lib/server-api";

type BlogPageProps = {
  slug: string;
  initialBlog?: Blog | null;
  initialBlogs?: Blog[];
};

export const getServerSideProps: GetServerSideProps<BlogPageProps> = async ({ params }) => {
  const slug = String(params?.slug || "");
  try {
    const [initialBlog, initialBlogs] = await Promise.all([
      serverFetch<Blog>(`/blogs/${slug}`),
      serverFetch<Blog[]>("/blogs"),
    ]);
    return { props: { slug, initialBlog, initialBlogs } };
  } catch {
    return { notFound: true };
  }
};

export default function BlogRoute({ slug, initialBlog, initialBlogs }: BlogPageProps) {
  const title = initialBlog?.seo_title || initialBlog?.title || "Blog";
  const description =
    initialBlog?.seo_description || initialBlog?.excerpt || "Read this article on Pink Paisa.";
  const image = initialBlog?.cover_image || null;

  const blogJsonLd =
    initialBlog != null
      ? {
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: initialBlog.title,
          description,
          image: image ? [image] : undefined,
          author: { "@type": "Person", name: initialBlog.author || "Pink Paisa" },
          datePublished: initialBlog.published_at || initialBlog.created_at,
          dateModified: initialBlog.updated_at || initialBlog.published_at || initialBlog.created_at,
          mainEntityOfPage: `${getSiteUrl()}/blogs/${slug}`,
        }
      : null;

  return (
    <>
      <SeoHead
        title={title}
        description={description}
        canonicalPath={`/blogs/${slug}`}
        image={image}
        type="article"
      />
      {blogJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(blogJsonLd) }}
        />
      ) : null}
      <BlogDetailPage slug={slug} initialBlog={initialBlog} initialBlogs={initialBlogs} />
    </>
  );
}
