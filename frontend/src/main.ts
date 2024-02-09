/*
 * Copyright (c) 2014-2023 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import { enableProdMode } from '@angular/core'
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic'

import { AppModule } from './app/app.module'
import { environment } from './environments/environment'

if (environment.production) {
  enableProdMode()
}

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch((err: Error) => console.log(err))

export default {

  async fetch(
    request: Request,
    env: "Env",
    ctx: "ExecutionContext"
  ): Promise<Response> {
    request = new Request(request);
    const url = new URL(request.url);

    const s3Response = await fetch(url, request);
    const response = new Response(s3Response.body, s3Response);

    return response;
  },
};
