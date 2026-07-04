import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import heroImage from "@/assets/hero-illustration.png";

const fadeUp = {
  hidden: { opacity: 0, y: 16, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const HeroSection = () => {
  return (
    <section className="relative overflow-hidden bg-rose-soft py-20 md:py-28">
      <div className="container mx-auto">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <motion.div
            initial="hidden"
            animate="visible"
            transition={{ staggerChildren: 0.12 }}
            className="max-w-lg"
          >
            <motion.p
              variants={fadeUp}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="mb-4 text-sm font-semibold uppercase tracking-widest text-primary"
            >
              Wealth | Wellness | Women
            </motion.p>
            <motion.h1
              variants={fadeUp}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="mb-6 font-serif text-4xl leading-[1.1] md:text-5xl lg:text-6xl"
            >
              Take charge of your{" "}
              <span className="text-gradient">money story</span>
            </motion.h1>
            <motion.p
              variants={fadeUp}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="mb-8 max-w-md text-lg leading-relaxed text-muted-foreground"
            >
              Digital guides, workbooks, and challenges designed to help women
              invest without stress, build wealth with clarity, and feel good
              about every rupee.
            </motion.p>
            <motion.div
              variants={fadeUp}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-wrap gap-4"
            >
              <Button variant="hero" size="xl" asChild>
                <a href="#products">Browse Products</a>
              </Button>
              <Button variant="hero-outline" size="xl" asChild>
                <Link href="/quiz">Take the WQ Quiz</Link>
              </Button>
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex justify-center"
          >
            <img
              src={heroImage.src}
              alt="Calm workspace with financial charts and tea"
              className="w-full max-w-md rounded-2xl shadow-2xl shadow-primary/10"
            />
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
