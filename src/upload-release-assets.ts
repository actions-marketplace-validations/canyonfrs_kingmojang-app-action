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

    const { data } = await github.rest.repos.getContent({
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: 'web/constants/app.ts',
      ref: context.sha,
    });

    console.log("data", data);

    // create branch
    const { data: { ref } } = await github.rest.git.createRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: 'refs/heads/chore/update-assets',
      sha: context.sha,
    });

    console.log(`Created branch chore/update-assets`);

    // create pull request
    const { data: { number: prNumber } } = await github.rest.pulls.create({
      owner: context.repo.owner,
      repo: context.repo.repo,
      title: `chore(release): ${assetName}`,
      head: 'chore/update-assets',
      base: 'main',
      body: `chore(release): ${assetName}`,
      maintainer_can_modify: true,
    });

    console.log(`Created pull request #${prNumber} for ${assetName}`)

    // update app.ts
    await github.rest.repos.createOrUpdateFileContents({
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: 'web/constants/app.ts',
      message: `chore(release): ${assetName}`,
      content: Buffer.from(
        data.toString().replace(new RegExp(`"${assetName}": ".*",`), `"${assetName}": "${browser_download_url}",`)
      ).toString('base64'),
      sha: context.sha,
      author: {
        name: 'junghyeonsu',
        email: 'jung660317@naver.com',
      },
      committer: {
        name: 'junghyeonsu',
        email: 'jung660317@naver.com',
      },
      branch: 'chore/update-assets',
    });

    console.log(`Updated app.ts for ${assetName}`)
  }
}
