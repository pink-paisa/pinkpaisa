import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Blog, useBlog, useBlogs } from "@/hooks/useBlogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar, User, Tag } from "lucide-react";
import { motion } from "framer-motion";
import { formatDateIN } from "@/lib/date";

const BlogDetail = ({
  slug: initialSlug,
  initialBlog,
  initialBlogs,
}: {
  slug?: string;
  initialBlog?: Blog | null;
  initialBlogs?: Blog[];
}) => {
  const slug = initialSlug ?? "";
  const { data: blog, isLoading, error } = useBlog(slug, initialBlog ?? null);
  const { data: allBlogs } = useBlogs(false, initialBlogs);

  const related = (allBlogs ?? [])
    .filter((b) => b.slug !== slug && b.category === blog?.category)
    .slice(0, 3);

  const formatDate = (d: string | null) => {
    if (!d) return "";
    return formatDateIN(d, { day: "numeric", month: "long", year: "numeric" });
  };

  // Simple markdown-like renderer for ## headings, bold, lists
  const renderContent = (content: string) => {
    return content.split("\n").map((line, i) => {
      if (line.startsWith("## ")) {
        return <h2 key={i} className="font-serif text-2xl mt-8 mb-4 text-foreground">{line.slice(3)}</h2>;
      }
      if (line.startsWith("- ")) {
        return <li key={i} className="ml-4 text-foreground/90">{line.slice(2)}</li>;
      }
      if (line.trim() === "") return <br key={i} />;
      // Handle bold
      const parts = line.split(/\*\*(.*?)\*\*/g);
      return (
        <p key={i} className="text-foreground/90 leading-relaxed">
          {parts.map((part, j) => j % 2 === 1 ? <strong key={j}>{part}</strong> : part)}
        </p>
      );
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center py-32"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      </div>
    );
  }

  if (error || !blog) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="container mx-auto px-4 py-32 text-center">
          <h1 className="font-serif text-3xl mb-4">Blog Not Found</h1>
          <p className="text-muted-foreground mb-6">The blog post you&apos;re looking for doesn&apos;t exist or has been unpublished.</p>
          <Button asChild><Link href="/blogs"><ArrowLeft className="h-4 w-4 mr-2" />Back to Blogs</Link></Button>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <article className="container mx-auto px-4 py-10 max-w-3xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Link href="/blogs" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
            <ArrowLeft className="h-4 w-4" /> Back to Blogs
          </Link>

          {blog.category && <Badge variant="secondary" className="mb-4">{blog.category}</Badge>}

          <h1 className="font-serif text-3xl md:text-4xl text-foreground mb-4">{blog.title}</h1>

          <div className="flex items-center gap-4 text-sm text-muted-foreground mb-8">
            <span className="flex items-center gap-1"><User className="h-4 w-4" />{blog.author}</span>
            <span className="flex items-center gap-1"><Calendar className="h-4 w-4" />{formatDate(blog.published_at)}</span>
          </div>

          {blog.cover_image && (
            <div className="rounded-2xl overflow-hidden mb-10">
              <img src={blog.cover_image} alt={blog.title} className="w-full h-auto object-cover" />
            </div>
          )}

          <div className="prose prose-lg max-w-none">
            {blog.content ? renderContent(blog.content) : <p className="text-muted-foreground">{blog.excerpt}</p>}
          </div>

          {blog.tags && blog.tags.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mt-10 pt-6 border-t border-border">
              <Tag className="h-4 w-4 text-muted-foreground" />
              {blog.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
              ))}
            </div>
          )}
        </motion.div>
      </article>

      {/* Related Blogs */}
      {related.length > 0 && (
        <section className="container mx-auto px-4 pb-16 max-w-3xl">
          <h2 className="font-serif text-2xl mb-6">Related Articles</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {related.map((r) => (
              <Link key={r.id} href={`/blogs/${r.slug}`} className="group rounded-xl border border-border bg-card p-4 hover:shadow-md transition-all">
                {r.cover_image && <img src={r.cover_image} alt={r.title} className="w-full h-24 object-cover rounded-lg mb-3" />}
                <h3 className="font-medium text-sm group-hover:text-primary transition-colors line-clamp-2">{r.title}</h3>
                <p className="text-xs text-muted-foreground mt-1">{formatDate(r.published_at)}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <Footer />
    </div>
  );
};

export default BlogDetail;

