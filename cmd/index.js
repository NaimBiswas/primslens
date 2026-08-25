import 'dotenv/config';
import { Command } from 'commander';
import { analyzePR } from '../lib/services/analyzer.js';
import { fetchPR, fetchPRFiles } from '../lib/services/github.js';
import { loadReviewConfig } from '../lib/services/review-config.js';

const program = new Command();

program
  .name('prismlens')
  .description('PrismLens CLI — opencode-style code review analysis')
  .version('1.0.0');

const CATEGORIES = [
  { key: 'performance', icon: '⚡', label: 'Performance' },
  { key: 'security', icon: '🔒', label: 'Security' },
  { key: 'readability', icon: '📖', label: 'Readability' },
  { key: 'bugs_cat', icon: '🐛', label: 'Bugs' },
  { key: 'scalability', icon: '📊', label: 'Scalability' },
  { key: 'best_practices', icon: '✅', label: 'Best Practices' },
];

program
  .command('review <pr-url>')
  .description('Review a GitHub PR')
  .option('-t, --token <token>', 'GitHub token (or set GITHUB_TOKEN env)')
  .option('-o, --output <file>', 'Save report to file')
  .option('--json', 'Output raw JSON')
  .action(async (prUrl, options) => {
    const token = options.token || process.env.GITHUB_TOKEN;

    if (!token) {
      console.error('❌ GitHub token required. Use --token or set GITHUB_TOKEN env.');
      process.exit(1);
    }

    console.log(`🔍 Fetching PR: ${prUrl}\n`);

    try {
      const [prData, files, config] = await Promise.all([
        fetchPR(prUrl, token),
        fetchPRFiles(prUrl, token),
        loadReviewConfig(prUrl, token),
      ]);

      const review = await analyzePR(prData, files, config, token, (stage, label) => {
        if (!options.json) console.log(`  → ${label}`);
      });

      if (options.json) {
        console.log(JSON.stringify(review, null, 2));
        return;
      }

      const { meta, recommendation } = review;

      const line = '─'.repeat(58);
      console.log(line);
      console.log(`  PR:      ${meta.prTitle}`);
      console.log(`  Author:  ${meta.prAuthor}`);
      console.log(`  Files:   ${meta.stats.filesChanged}  (+${meta.stats.additions}/-${meta.stats.deletions})`);
      console.log(`  Branch:  ${meta.branch || '?'}`);
      console.log(`  Mode:    ${meta.analysisMode === 'ai' ? 'AI (opencode)' : 'regex fallback'}`);
      if (meta.analysisMode === 'fallback' && meta.fallbackReason) {
        console.log(`  Reason:  ${meta.fallbackReason}`);
      }
      console.log(line);

      for (const cat of CATEGORIES) {
        const items = review[cat.key] || [];
        if (!items.length) continue;
        console.log(`\n  ${cat.icon} ${cat.label} (${items.length})`);
        const bugs = items.filter((i) => i.type === 'BUG').length;
        const concerns = items.filter((i) => i.type === 'CONCERN').length;
        const info = items.filter((i) => i.type === 'INFO').length;
        const strengths = items.filter((i) => i.type === 'STRENGTH').length;
        const summary = [];
        if (bugs) summary.push(`${bugs} bug(s)`);
        if (concerns) summary.push(`${concerns} concern(s)`);
        if (info) summary.push(`${info} info`);
        if (strengths) summary.push(`${strengths} strength(s)`);
        if (summary.length) console.log(`     [${summary.join(', ')}]`);

        items.forEach((r, i) => {
          const sev = r.severity ? `[${r.severity}]` : '';
          console.log(`    ${i + 1}. ${sev} ${r.issue}`);
          if (r.recommendation) console.log(`       > ${r.recommendation}`);
        });
      }

      console.log(`\n${line}`);
      console.log(`  🎯 ${recommendation.label}`);
      console.log(`     ${recommendation.reason}`);
      console.log(line);

      if (options.output) {
        const fs = await import('fs');
        const md = generateMarkdown(review);
        fs.writeFileSync(options.output, md, 'utf-8');
        console.log(`\n📄 Report saved to: ${options.output}`);
      }

    } catch (err) {
      console.error(`❌ Error: ${err.response?.data?.message || err.message}`);
      process.exit(1);
    }
  });

program.parse();

function generateMarkdown(review) {
  const { meta, recommendation } = review;
  let md = `# Code Review: ${meta.prTitle}\n\n`;
  md += `**Author:** ${meta.prAuthor}  \n`;
  md += `**Files:** ${meta.stats.filesChanged} (+${meta.stats.additions}/-${meta.stats.deletions})  \n`;
  md += `**Branch:** ${meta.branch || '?'}  \n\n`;

  for (const cat of CATEGORIES) {
    const items = review[cat.key] || [];
    if (!items.length) continue;
    md += `## ${cat.icon} ${cat.label}\n\n`;
    items.forEach((r) => {
      const sev = r.severity ? `${r.severity} ` : '';
      md += `- **${r.type}** ${sev}${r.issue}\n`;
      if (r.recommendation) md += `  > ${r.recommendation}\n`;
    });
    md += '\n';
  }

  md += `## 🎯 Recommendation\n\n**${recommendation.label}**  \n${recommendation.reason}\n`;
  return md;
}
