const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");

const instagram = require("../services/instagramPublishService");

const connection = {
  instagram_user_id: "ig-professional-1",
  instagram_username: "pinkpaisa",
  user_access_token: "test-token",
  account_type: "BUSINESS",
};

async function withSuccessfulMetaMock(run) {
  const originalPost = axios.post;
  const originalGet = axios.get;
  const containers = [];
  let containerIndex = 0;
  let mediaIndex = 0;
  axios.post = async (url, body) => {
    if (url.endsWith("/media_publish")) {
      mediaIndex += 1;
      return { data: { id: `media-${mediaIndex}` } };
    }
    containerIndex += 1;
    containers.push(Object.fromEntries(body.entries()));
    return { data: { id: `container-${containerIndex}` } };
  };
  axios.get = async (url, options) => {
    if (String(options?.params?.fields || "").includes("permalink")) {
      const id = url.split("/").at(-1);
      return { data: { id, permalink: `https://www.instagram.com/p/${id}/` } };
    }
    return { data: { id: url.split("/").at(-1), status_code: "FINISHED" } };
  };
  try {
    await run(containers);
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
  }
}

test("Reel and app-level Video Feed both use a REELS container shared to the feed", async () => {
  await withSuccessfulMetaMock(async (containers) => {
    const reel = await instagram.publishVideo({
      connection,
      assetUrls: ["https://cdn.example.com/reel.mp4"],
      caption: "Reel caption",
      contentType: "reel",
    });
    const videoFeed = await instagram.publishVideo({
      connection,
      assetUrls: ["https://cdn.example.com/video-feed.mp4"],
      caption: "Video Feed caption",
      contentType: "video_feed",
    });

    assert.equal(containers[0].media_type, "REELS");
    assert.equal(containers[0].share_to_feed, "true");
    assert.equal(containers[0].video_url, "https://cdn.example.com/reel.mp4");
    assert.equal(containers[1].media_type, "REELS");
    assert.equal(containers[1].share_to_feed, "true");
    assert.equal(reel.media_id, "media-1");
    assert.equal(videoFeed.media_id, "media-2");
    assert.equal(videoFeed.content_type, "video_feed");
  });
});

test("Story image and video success payloads use STORIES and never leak a feed caption", async () => {
  await withSuccessfulMetaMock(async (containers) => {
    const imageStory = await instagram.publishSingleImage({
      connection,
      assetUrls: ["https://cdn.example.com/story.jpg"],
      caption: "This must not enter a Story container",
      contentType: "story",
    });
    const videoStory = await instagram.publishVideo({
      connection,
      assetUrls: ["https://cdn.example.com/story.mp4"],
      caption: "This must not enter a Story container",
      contentType: "story",
    });

    assert.equal(containers[0].media_type, "STORIES");
    assert.equal(containers[0].image_url, "https://cdn.example.com/story.jpg");
    assert.equal(containers[0].caption, undefined);
    assert.equal(containers[1].media_type, "STORIES");
    assert.equal(containers[1].video_url, "https://cdn.example.com/story.mp4");
    assert.equal(containers[1].caption, undefined);
    assert.equal(containers[1].share_to_feed, undefined);
    assert.equal(imageStory.media_id, "media-1");
    assert.equal(videoStory.media_id, "media-2");
  });
});

test("a failed post-publish media lookup preserves the real media ID and returns a safe enrichment warning", async () => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  const checkpoints = [];
  try {
    axios.post = async (url) => ({ data: { id: url.endsWith("/media_publish") ? "media-enrichment-warning" : "container-enrichment-warning" } });
    axios.get = async (_url, options) => {
      if (String(options?.params?.fields || "").includes("permalink")) {
        const error = new Error("provider details intentionally hidden");
        error.response = { status: 503, data: { error: { code: 2 } } };
        throw error;
      }
      return { data: { status_code: "FINISHED" } };
    };

    const result = await instagram.publishSingleImage({
      connection,
      assetUrls: ["https://cdn.example.com/published.jpg"],
      caption: "Approved caption",
      onProgress: async (checkpoint) => { checkpoints.push(checkpoint); },
    });

    assert.equal(result.media_id, "media-enrichment-warning");
    assert.equal(result.permalink, null);
    assert.equal(result.enrichment_warning.code, "instagram_media_enrichment_failed");
    assert.equal(result.enrichment_warning.provider_status, 503);
    assert.equal(result.enrichment_warning.provider_code, "2");
    assert.equal(result.enrichment_warning.is_retriable, true);
    assert.doesNotMatch(JSON.stringify(result.enrichment_warning), /provider details intentionally hidden/i);
    assert.equal(checkpoints.at(-1).status, "published");
    assert.equal(checkpoints.at(-1).media_id, "media-enrichment-warning");
    assert.equal(checkpoints.at(-1).enrichment_warning.code, "instagram_media_enrichment_failed");
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
  }
});

test("container polling distinguishes eventual success, terminal failure, and still-pending media", async () => {
  const originalGet = axios.get;
  try {
    let calls = 0;
    axios.get = async () => ({ data: { status_code: ++calls === 1 ? "IN_PROGRESS" : "FINISHED" } });
    const finished = await instagram.pollPublishStatus("container-eventual", "token", { maxAttempts: 2, delayMs: 0 });
    assert.equal(finished.status_code, "FINISHED");

    axios.get = async () => ({ data: { status_code: "ERROR", status: "Invalid video" } });
    await assert.rejects(
      () => instagram.pollPublishStatus("container-error", "token", { maxAttempts: 1, delayMs: 0 }),
      (error) => error.code === "instagram_container_failed"
        && error.details.container_failure_terminal === true,
    );

    axios.get = async () => ({ data: { status_code: "IN_PROGRESS" } });
    await assert.rejects(
      () => instagram.pollPublishStatus("container-pending", "token", { maxAttempts: 1, delayMs: 0 }),
      (error) => error.code === "instagram_container_pending"
        && error.details.container_failure_terminal === false,
    );
  } finally {
    axios.get = originalGet;
  }
});

test("provider publishing quota is preserved while Video Feed routing remains dependency-testable", async () => {
  let publisherCalls = 0;
  const baseDependencies = {
    getActiveInstagramConnection: async () => connection,
    markInstagramConnectionError: async () => {},
    markInstagramPublishSuccess: async () => {},
  };
  await assert.rejects(
    () => instagram.publishInstagramDraft({
      contentType: "video_feed",
      assetUrls: ["https://cdn.example.com/video-feed.mp4"],
      assetMimeTypes: ["video/mp4"],
      caption: "Video Feed caption",
      dependencies: {
        ...baseDependencies,
        getContentPublishingLimit: async () => ({ data: [{ quota_usage: 25, quota_total: 25 }] }),
        publishVideo: async () => { publisherCalls += 1; return { media_id: "unexpected" }; },
      },
    }),
    (error) => error.code === "instagram_publishing_quota_reached"
      && error.details.provider === "META",
  );
  assert.equal(publisherCalls, 0);

  const result = await instagram.publishInstagramDraft({
    contentType: "video_feed",
    assetUrls: ["https://cdn.example.com/video-feed.mp4"],
    assetMimeTypes: ["video/mp4"],
    caption: "Video Feed caption",
    dependencies: {
      ...baseDependencies,
      getContentPublishingLimit: async () => ({ data: [{ quota_usage: 2, quota_total: 25 }] }),
      publishVideo: async (input) => {
        publisherCalls += 1;
        assert.equal(input.contentType, "video_feed");
        return { content_type: "video_feed", creation_id: "container-routed", media_id: "media-routed", permalink: null };
      },
    },
  });
  assert.equal(result.media_id, "media-routed");
  assert.equal(publisherCalls, 1);
});
