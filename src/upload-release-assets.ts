import fs from 'fs';

import { getOctokit, context } from '@actions/github';

import { getAssetName } from './utils';
import type { Artifact } from './types';

export async function uploadAssets(releaseId: number, assets: Artifact[]) {
  if (process.env.GITHUB_TOKEN === undefined) {
    throw new Error('GITHUB_TOKEN is required');
  }

  const github = getOctokit(process.env.GITHUB_TOKEN);

  const existingAssets = (
    await github.rest.repos.listReleaseAssets({
      owner: context.repo.owner,
      repo: context.repo.repo,
      release_id: releaseId,
      per_page: 50,
    })
  ).data;

  // Determine content-length for header to upload asset
  const contentLength = (filePath: string) => fs.statSync(filePath).size;

  for (const asset of assets) {
    const headers = {
      'content-type': 'application/zip',
      'content-length': contentLength(asset.path),
    };

    const assetName = getAssetName(asset.path);

    const existingAsset = existingAssets.find(
      (a) => a.name === assetName.trim().replace(/ /g, '.')
    );
    if (existingAsset) {
      console.log(`Deleting existing ${assetName}...`);
      await github.rest.repos.deleteReleaseAsset({
        owner: context.repo.owner,
        repo: context.repo.repo,
        asset_id: existingAsset.id,
      });
    }

    console.log(`Uploading ${assetName}...`);

    const { data: { browser_download_url } } = await github.rest.repos.uploadReleaseAsset({
      headers,
      name: assetName,
      // https://github.com/tauri-apps/tauri-action/pull/45
      // @ts-ignore error TS2322: Type 'Buffer' is not assignable to type 'string'.
      data: fs.readFileSync(asset.path),
      owner: context.repo.owner,
      repo: context.repo.repo,
      release_id: releaseId,
    });

    console.log(`Uploaded ${assetName} to ${browser_download_url}`);

    await github.rest.repos.createOrUpdateFileContents({
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: 'web/constants/app.ts',
      message: `chore(release): ${assetName}`,
      content: Buffer.from(
        fs.readFileSync('web/constants/app.ts', 'utf8')
          .replace(new RegExp(`"${assetName}": ".*",`), `"${assetName}": "${browser_download_url}",`)
      ).toString('base64'),
      sha: context.sha,
    });

    console.log(`Updated ${assetName} in web/constants/app.ts`);

    // create pull request
    const { data: { number } } = await github.rest.pulls.create({
      owner: context.repo.owner,
      repo: context.repo.repo,
      title: `chore(release): ${assetName}`,
      head: `release/${assetName}`,
      base: 'main',
      body: `chore(release): ${assetName}`,
    });

    console.log(`Created pull request #${number} for ${assetName}`)
  }
}
