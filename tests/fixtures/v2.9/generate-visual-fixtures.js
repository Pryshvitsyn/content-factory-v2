'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FIXTURES = Object.freeze({
  singleComposition: { technical: 'PASS', visual: 'PASS', filter: 'testsrc2=size=720x1280:rate=24' },
  triptych: { technical: 'PASS', visual: 'FAIL', filter: 'testsrc2=size=720x1280:rate=24,drawbox=y=420:w=iw:h=14:c=black:t=fill,drawbox=y=846:w=iw:h=14:c=black:t=fill' },
  verticalSplit: { technical: 'PASS', visual: 'FAIL', filter: 'testsrc2=size=720x1280:rate=24,drawbox=x=353:w=14:h=ih:c=black:t=fill' },
  horizontalSplit: { technical: 'PASS', visual: 'FAIL', filter: 'testsrc2=size=720x1280:rate=24,drawbox=y=633:w=iw:h=14:c=black:t=fill' },
  contactSheet: { technical: 'PASS', visual: 'FAIL', filter: 'testsrc2=size=720x1280:rate=24,drawbox=x=353:w=14:h=ih:c=black:t=fill,drawbox=y=633:w=iw:h=14:c=black:t=fill' },
  pictureInPicture: { technical: 'PASS', visual: 'SEMANTIC_FAIL', filter: 'testsrc2=size=720x1280:rate=24,drawbox=x=390:y=80:w=280:h=420:c=black:t=12,drawbox=x=402:y=92:w=256:h=396:c=blue:t=fill' },
  largeBlackBorders: { technical: 'PASS', visual: 'WARN', filter: 'testsrc2=size=560x980:rate=24,pad=720:1280:80:150:black' },
  blankFrames: { technical: 'PASS', visual: 'FAIL', filter: 'color=c=white:size=720x1280:rate=24' },
  freezeStatic: { technical: 'PASS', visual: 'FAIL', filter: 'color=c=blue:size=720x1280:rate=24,drawbox=x=120:y=280:w=480:h=720:c=orange:t=fill' },
  fakeTextLike: { technical: 'PASS', visual: 'SEMANTIC_FAIL', filter: 'testsrc2=size=720x1280:rate=24,drawbox=x=90:y=980:w=540:h=100:c=black@0.6:t=fill,drawbox=x=125:y=1015:w=55:h=12:c=white:t=fill,drawbox=x=195:y=1000:w=16:h=42:c=white:t=fill,drawbox=x=230:y=1015:w=80:h=12:c=white:t=fill,drawbox=x=330:y=1000:w=16:h=42:c=white:t=fill,drawbox=x=365:y=1015:w=120:h=12:c=white:t=fill' },
  visuallyUnacceptable: { technical: 'PASS', visual: 'FAIL',
    filter: "color=c=black:size=720x1280:rate=24,geq=lum='if(lt(mod(T,0.8),0.4),255,0)':cb=128:cr=128" },
  technicalFailureVisuallyNormal: { technical: 'FAIL', visual: 'NORMAL_STILL', still: true },
});

function run(args) {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `ffmpeg exited ${result.status}`);
}

function generateFixtureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    const output = path.join(directory, `${name}.mp4`);
    if (fixture.still) {
      run(['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=720x1280:rate=1','-frames:v','1','-f','image2','-vcodec','png','-y',output]);
    } else {
      run(['-hide_banner','-loglevel','error','-f','lavfi','-i',fixture.filter,'-t','2','-c:v','libx264','-pix_fmt','yuv420p','-preset','ultrafast','-crf','28','-movflags','+faststart','-y',output]);
    }
  }
  const manifest = { schemaVersion: '2.9', deterministic: true, paidProviderCalls: 0,
    fixtures: Object.fromEntries(Object.entries(FIXTURES).map(([name, value]) => [name, { ...value, file: `${name}.mp4` }])) };
  fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'w' });
  return manifest;
}

if (require.main === module) generateFixtureDirectory(process.argv[2] || path.resolve(process.cwd(), '.tmp-v2.9-fixtures'));

module.exports = { FIXTURES, generateFixtureDirectory };
