import { Router } from 'express';
import { fetchPR, fetchPRFiles, postPRReview, mergePR } from '../services/github.js';
import { analyzePR } from '../services/analyzer.js';

const router = Router();

/**
 * POST /api/review
 * Body: { prUrl: string, token: string }
 * Returns: { meta, reviews, strengths, concerns, bugs, info, recommendation, files }
 */
router.post('/review', async (req, res) => {
  const { prUrl, token } = req.body;

  if (!prUrl) return res.status(400).json({ error: 'prUrl is required' });
  if (!token) return res.status(400).json({ error: 'GitHub token is required' });

  try {
    const [prData, files] = await Promise.all([
      fetchPR(prUrl, token),
      fetchPRFiles(prUrl, token),
    ]);

    const review = analyzePR(prData, files);
    res.json(review);
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data;
    const msg = data?.errors?.[0]?.message || data?.message || err.message;
    res.status(status).json({ error: msg });
  }
});

/**
 * POST /api/review/preview
 * Body: { prUrl, token }
 * Returns: { prData } — raw PR metadata (lightweight preview)
 */
router.post('/review/preview', async (req, res) => {
  const { prUrl, token } = req.body;

  if (!prUrl) return res.status(400).json({ error: 'prUrl is required' });
  if (!token) return res.status(400).json({ error: 'GitHub token is required' });

  try {
    const prData = await fetchPR(prUrl, token);
    res.json({
      title: prData.title,
      author: prData.user?.login,
      number: prData.number,
      state: prData.state,
      html_url: prData.html_url,
      created_at: prData.created_at,
      head: { ref: prData.head?.ref, sha: prData.head?.sha },
      base: { ref: prData.base?.ref, sha: prData.base?.sha },
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data;
    const msg = data?.errors?.[0]?.message || data?.message || err.message;
    res.status(status).json({ error: msg });
  }
});

/**
 * POST /api/review/post
 * Body: { prUrl, token, review, event? }
 * Posts review as a GitHub PR review comment. Default event: COMMENT
 */
router.post('/review/post', async (req, res) => {
  const { prUrl, token, review, event } = req.body;

  if (!prUrl) return res.status(400).json({ error: 'prUrl is required' });
  if (!token) return res.status(400).json({ error: 'GitHub token is required' });
  if (!review) return res.status(400).json({ error: 'review data is required' });

  try {
    const result = await postPRReview(prUrl, token, review, event);
    res.json({ id: result.id, html_url: result.html_url, message: 'Review posted successfully' });
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data;
    const msg = data?.errors?.join(", ") || data?.message || err.message;
    res.status(status).json({ error: msg });
  }
});

/**
 * POST /api/review/merge
 * Body: { prUrl, token, mergeMethod? }
 * Merges the pull request
 */
router.post('/review/merge', async (req, res) => {
  const { prUrl, token, mergeMethod } = req.body;

  if (!prUrl) return res.status(400).json({ error: 'prUrl is required' });
  if (!token) return res.status(400).json({ error: 'GitHub token is required' });

  try {
    const result = await mergePR(prUrl, token, mergeMethod || 'merge');
    res.json({ sha: result.sha, merged: result.merged, message: result.message || 'Pull request merged' });
  } catch (err) {
    console.log(JSON.stringify(err?.response.data, null, 2))
    const status = err.response?.status || 500;
    const data = err.response?.data;
    const msg = data?.errors?.[0]?.message || data?.message || err.message;
    res.status(status).json({ error: msg });
  }
});

/**
 * GET /api/health
 * Returns server health check
 */
router.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
