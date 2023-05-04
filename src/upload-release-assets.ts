import fs from 'fs';

import { getOctokit, context } from '@actions/github';

import { getAssetName } from './utils';
import type { Artifact } from './types';

const BRANCH_NAME = 'chore/update-assets-DO-NOT-REMOVE';

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

    const { data: fileData } = await github.rest.repos.getContent({
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: 'web/constants/app.ts',
      ref: context.sha,
    });

    if (!fileData) {
      throw new Error('content is undefined');
    }

    let sha = "";

    const { data: { ref, object } } = await github.rest.git.getRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: `heads/${BRANCH_NAME}`,
    });

    sha = object.sha;

    if (ref) {
      console.log(`Found branch ${BRANCH_NAME}`);
    } else {
      const { data: { object } } = await github.rest.git.createRef({
        owner: context.repo.owner,
        repo: context.repo.repo,
        ref: `refs/heads/${BRANCH_NAME}`,
        sha: context.sha,
      });

      sha = object.sha;

      console.log(`Created branch chore/update-assets`);
    }

    // TODO: FIX THIS
    const newFileData = fileData.toString().replace(
      /export const ASSETS_URL = '.*';/,
      `export const ASSETS_URL = '${browser_download_url}';`
    );

    const { data: { content } } =  await github.rest.repos.createOrUpdateFileContents({
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: 'web/constants/app.ts',
      message: `chore: update assets url`,
      content: Buffer.from(newFileData).toString('base64'),
      sha: sha,
      branch: BRANCH_NAME,
    });

    console.log(`Updated assets url in web/constants/app.ts`);

    if (!content?.sha) {
      throw new Error('sha is undefined');
    }

    await github.rest.git.updateRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: `heads/${BRANCH_NAME}`,
      sha: content?.sha,
      force: true,
    });

    console.log(`Updated branch chore/update-assets`);

    await github.rest.pulls.create({
      owner: context.repo.owner,
      repo: context.repo.repo,
      title: `chore: update assets url`,
      head: BRANCH_NAME,
      base: 'main',
      body: `This PR updates the assets url in web/constants/app.ts to ${browser_download_url}`,
    });

    console.log(`Created PR chore/update-assets`);
  }
}
