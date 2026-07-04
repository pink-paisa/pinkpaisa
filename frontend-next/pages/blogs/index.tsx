import type { GetServerSideProps } from "next";
import BlogsPage from "@/pages/Blogs";
import SeoHead from "@/components/SeoHead";
import { Blog } from "@/hooks/useBlogs";
import { serverFetch } from "@/lib/server-api";

type BlogsPageProps = {
  initialBlogs?: Blog[];
};

export const getServerSideProps: GetServerSideProps<BlogsPageProps> = async () => {
  try {
    const initialBlogs = await serverFetch<Blog[]>("/blogs");
    return { props: { initialBlogs } };
  } catch {
    return { props: {} };
  }
};

export default function BlogsRoute({ initialBlogs }: BlogsPageProps) {
  return (
    <>
      <SeoHead
        title="Blog"
        description="Read Pink Paisa articles on wellness, finance, self-growth, and women-first living."
        canonicalPath="/blogs"
        type="article"
      />
      <BlogsPage initialBlogs={initialBlogs} />
    </>
  );
}
