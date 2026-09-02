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

test("an ordered mixed-media Story sequence publishes every frame once with no captions", async () => {
  const created = [];
  const published = [];
  const checkpoints = [];
  let nextContainer = 0;
  const result = await instagram.publishStorySequence({
    connection,
    assetUrls: [
      "https://cdn.example.com/story-1.jpg",
      "https://cdn.example.com/story-2.mp4",
      "https://cdn.example.com/story-3.png",
    ],
    assetMimeTypes: ["image/jpeg", "video/mp4", "image/png"],
    onProgress: async (checkpoint) => { checkpoints.push(structuredClone(checkpoint)); },
    dependencies: {
      createImageContainer: async (_userId, _token, input) => {
        assert.equal(input.caption, null);
        assert.equal(input.mediaType, "STORIES");
        created.push({ kind: "image", url: input.imageUrl });
        return { id: `story-container-${++nextContainer}` };
      },
      createVideoContainer: async (_userId, _token, input) => {
        assert.equal(input.caption, null);
        assert.equal(input.mediaType, "STORIES");
        assert.equal(input.shareToFeed, null);
        created.push({ kind: "video", url: input.videoUrl });
        return { id: `story-container-${++nextContainer}` };
      },
      pollPublishStatus: async (containerId) => ({ id: containerId, status_code: "FINISHED" }),
      publishContainer: async (_userId, _token, creationId) => {
        published.push(creationId);
        return { id: `story-media-${published.length}` };
      },
      enrichPublishedMediaInfo: async (mediaId) => ({
        mediaInfo: { id: mediaId, permalink: `https://www.instagram.com/stories/${mediaId}/` },
        warning: null,
      }),
    },
  });

  assert.deepEqual(created, [
    { kind: "image", url: "https://cdn.example.com/story-1.jpg" },
    { kind: "video", url: "https://cdn.example.com/story-2.mp4" },
    { kind: "image", url: "https://cdn.example.com/story-3.png" },
  ]);
  assert.deepEqual(published, ["story-container-1", "story-container-2", "story-container-3"]);
  assert.deepEqual(result.media_ids, ["story-media-1", "story-media-2", "story-media-3"]);
  assert.equal(result.media_id, "story-media-1");
  assert.equal(result.story_frames.length, 3);
  assert.deepEqual(result.story_frames.map((frame) => frame.sequence), [1, 2, 3]);
  assert.equal(checkpoints.at(-1).status, "published");
  assert.deepEqual(checkpoints.at(-1).media_ids, result.media_ids);
  assert.equal(checkpoints.at(-1).media_id, "story-media-1");
});

test("Story sequence resume skips confirmed frames and continues from the durable ordered checkpoint", async () => {
  const created = [];
  const published = [];
  const result = await instagram.publishStorySequence({
    connection,
    assetUrls: [
      "https://cdn.example.com/resume-1.jpg",
      "https://cdn.example.com/resume-2.jpg",
      "https://cdn.example.com/resume-3.jpg",
    ],
    assetMimeTypes: ["image/jpeg", "image/jpeg", "image/jpeg"],
    resumeState: {
      status: "container_created",
      story_frames: [
        {
          sequence: 1,
          asset_url_sha256: require("node:crypto").createHash("sha256").update("https://cdn.example.com/resume-1.jpg").digest("hex"),
          mime_type: "image/jpeg",
          creation_id: "resume-container-1",
          media_id: "resume-media-1",
          status: "published",
        },
        {
          sequence: 2,
          asset_url_sha256: require("node:crypto").createHash("sha256").update("https://cdn.example.com/resume-2.jpg").digest("hex"),
          mime_type: "image/jpeg",
          creation_id: "resume-container-2",
          media_id: null,
          status: "container_created",
        },
      ],
    },
    onProgress: async () => {},
    dependencies: {
      createImageContainer: async (_userId, _token, input) => {
        created.push(input.imageUrl);
        return { id: "resume-container-3" };
      },
      pollPublishStatus: async (containerId) => ({ id: containerId, status_code: "FINISHED" }),
      publishContainer: async (_userId, _token, creationId) => {
        published.push(creationId);
        return { id: creationId === "resume-container-2" ? "resume-media-2" : "resume-media-3" };
      },
      enrichPublishedMediaInfo: async (mediaId) => ({ mediaInfo: { id: mediaId }, warning: null }),
    },
  });

  assert.deepEqual(created, ["https://cdn.example.com/resume-3.jpg"]);
  assert.deepEqual(published, ["resume-container-2", "resume-container-3"]);
  assert.deepEqual(result.media_ids, ["resume-media-1", "resume-media-2", "resume-media-3"]);
  assert.equal(result.resumed, true);
});

test("a later Story frame with an uncertain provider outcome never publishes subsequent frames", async () => {
  const created = [];
  const published = [];
  const checkpoints = [];
  await assert.rejects(
    () => instagram.publishStorySequence({
      connection,
      assetUrls: [
        "https://cdn.example.com/uncertain-1.jpg",
        "https://cdn.example.com/uncertain-2.jpg",
        "https://cdn.example.com/uncertain-3.jpg",
      ],
      assetMimeTypes: ["image/jpeg", "image/jpeg", "image/jpeg"],
      onProgress: async (checkpoint) => { checkpoints.push(structuredClone(checkpoint)); },
      dependencies: {
        createImageContainer: async (_userId, _token, input) => {
          created.push(input.imageUrl);
          return { id: `uncertain-container-${created.length}` };
        },
        pollPublishStatus: async () => ({ status_code: "FINISHED" }),
        publishContainer: async (_userId, _token, creationId) => {
          published.push(creationId);
          if (creationId === "uncertain-container-2") throw new Error("connection closed before Meta replied");
          return { id: "uncertain-media-1" };
        },
        enrichPublishedMediaInfo: async (mediaId) => ({ mediaInfo: { id: mediaId }, warning: null }),
      },
    }),
    (error) => error.code === "instagram_publish_outcome_uncertain"
      && error.details.instagram_outcome_uncertain === true
      && error.details.failed_frame_index === 1
      && error.details.media_ids[0] === "uncertain-media-1",
  );
  assert.equal(created.length, 2);
  assert.deepEqual(published, ["uncertain-container-1", "uncertain-container-2"]);
  assert.equal(checkpoints.some((checkpoint) => checkpoint.status === "story_frame_published"), true);
});

test("a resumed Story frame past the pre-publish checkpoint is quarantined without another provider call", async () => {
  let providerCalls = 0;
  await assert.rejects(
    () => instagram.publishStorySequence({
      connection,
      assetUrls: ["https://cdn.example.com/checkpoint-uncertain.jpg"],
      assetMimeTypes: ["image/jpeg"],
      resumeState: {
        status: "publishing",
        story_frames: [{
          sequence: 1,
          asset_url_sha256: require("node:crypto").createHash("sha256").update("https://cdn.example.com/checkpoint-uncertain.jpg").digest("hex"),
          mime_type: "image/jpeg",
          creation_id: "checkpoint-uncertain-container",
          media_id: null,
          status: "publishing",
        }],
      },
      dependencies: {
        pollPublishStatus: async () => { providerCalls += 1; },
        publishContainer: async () => { providerCalls += 1; },
      },
    }),
    (error) => error.code === "instagram_story_publish_outcome_uncertain"
      && error.details.instagram_outcome_uncertain === true,
  );
  assert.equal(providerCalls, 0);
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

test("Story sequence quota is checked for every frame before the first provider publish", async () => {
  let storyPublisherCalls = 0;
  await assert.rejects(
    () => instagram.publishInstagramDraft({
      contentType: "story",
      assetUrls: ["https://cdn.example.com/quota-1.jpg", "https://cdn.example.com/quota-2.jpg"],
      assetMimeTypes: ["image/jpeg", "image/jpeg"],
      caption: "Stories must not use this caption",
      dependencies: {
        getActiveInstagramConnection: async () => connection,
        getContentPublishingLimit: async () => ({ data: [{ quota_usage: 24, quota_total: 25 }] }),
        publishStorySequence: async () => {
          storyPublisherCalls += 1;
          return { media_id: "unexpected", media_ids: ["unexpected-1", "unexpected-2"] };
        },
        markInstagramConnectionError: async () => {},
        markInstagramPublishSuccess: async () => {},
      },
    }),
    (error) => error.code === "instagram_publishing_quota_reached"
      && error.details.requested_publication_count === 2,
  );
  assert.equal(storyPublisherCalls, 0);
});

test("the top-level Instagram adapter routes every Story through the sequence publisher without a caption", async () => {
  let routedInput = null;
  const result = await instagram.publishInstagramDraft({
    contentType: "story",
    assetUrls: ["https://cdn.example.com/routed-1.jpg", "https://cdn.example.com/routed-2.mp4"],
    assetMimeTypes: ["image/jpeg", "video/mp4"],
    caption: "This feed caption must never reach a Story frame",
    dependencies: {
      getActiveInstagramConnection: async () => connection,
      getContentPublishingLimit: async () => ({ data: [{ quota_usage: 2, quota_total: 25 }] }),
      publishStorySequence: async (input) => {
        routedInput = input;
        return {
          content_type: "story",
          creation_id: "routed-container-1",
          creation_ids: ["routed-container-1", "routed-container-2"],
          child_creation_ids: ["routed-container-1", "routed-container-2"],
          media_id: "routed-media-1",
          media_ids: ["routed-media-1", "routed-media-2"],
          story_frames: [],
        };
      },
      markInstagramConnectionError: async () => {},
      markInstagramPublishSuccess: async () => {},
    },
  });
  assert.equal(Object.hasOwn(routedInput, "caption"), false);
  assert.deepEqual(routedInput.assetMimeTypes, ["image/jpeg", "video/mp4"]);
  assert.deepEqual(result.media_ids, ["routed-media-1", "routed-media-2"]);
});
