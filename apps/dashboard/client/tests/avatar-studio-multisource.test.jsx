import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  IdentityCoverage,
  buildMinorIdentityLockRevision,
  buildMinorIdentityRevision,
  currentIdentityLock,
  identityCoverage,
  isMinorIdentity,
} from '../src/IdentitySourceTools';

function source(id,viewpoint) {
  return { id,sourceType:'IMAGE',gate0Status:'PASS',provenance:{identityViewpoint:viewpoint} };
}

function adultAvatar() {
  return {
    id:'avatar-1',identityVersionId:'identity-v1',
    identity:{
      agePresentation:'adult age range',
      personality:'calm, warm, mature, trustworthy',
      role:'premium lifestyle avatar',languages:['en'],
      visualDirection:'photorealistic premium lifestyle avatar',
      permanentAttributes:{ facialStructure:'preserve',adultAgeRange:'adult',nose:'preserve' },
      prohibitedUses:['sexual content'],
    },
    identityLocks:[{
      id:'lock-v1',identityVersionId:'identity-v1',version:1,
      permanentAttributes:{ facialStructure:'preserve',adultAgeRange:'adult',nose:'preserve',jaw:'preserve' },
      temporaryAttributes:{ wardrobe:'exclude',lighting:'exclude' },
      uncertainAttributes:{ eyeColor:'source unclear' },
    }],
  };
}

describe('Avatar Studio multi-source identity evidence',()=>{
  it('reports limited coverage when a true profile is missing',()=>{
    const result=identityCoverage([source('a','FRONTAL'),source('b','THREE_QUARTER_RIGHT')]);
    expect(result.state).toBe('GOOD');
    expect(result.profile).toBe(false);
    expect(result.recommendations.join(' ')).toContain('true profile');
  });

  it('reports strong coverage without converting view labels into identity',()=>{
    const result=identityCoverage([
      source('a','FRONTAL'),source('b','THREE_QUARTER_LEFT'),source('c','THREE_QUARTER_RIGHT'),
      source('d','PROFILE_LEFT'),source('e','PROFILE_RIGHT'),
    ]);
    expect(result.state).toBe('STRONG');
    expect(result.views).toContain('PROFILE_RIGHT');
    expect(Object.keys(result)).not.toContain('permanentAttributes');
  });

  it('renders evidence gaps as operator guidance only',()=>{
    render(<IdentityCoverage sources={[source('a','FRONTAL')]}/>);
    expect(screen.getByText('IDENTITY COVERAGE')).toBeTruthy();
    expect(screen.getByText('LIMITED')).toBeTruthy();
    expect(screen.getByText('Add a 45° / three-quarter reference.')).toBeTruthy();
    expect(screen.getByText('Add a true profile reference before profile certification.')).toBeTruthy();
  });

  it('creates a new minor identity payload without carrying adult-age semantics forward',()=>{
    const avatar=adultAvatar();
    const revised=buildMinorIdentityRevision(avatar);
    expect(revised.agePresentation).toContain('MINOR');
    expect(revised.permanentAttributes.subjectAgeClass).toBe('MINOR');
    expect(revised.permanentAttributes.ageHandling).toBe('PRESERVE_SOURCE_SUPPORTED_APPARENT_AGE');
    expect(revised.permanentAttributes.adultAgeRange).toBeUndefined();
    expect(revised.permanentAttributes.facialStructure).toBe('preserve');
    expect(revised.permanentAttributes.nose).toBe('preserve');
    expect(revised.personality).not.toMatch(/\bmature\b/i);
    expect(revised.prohibitedUses.join(' ')).toMatch(/adultization/i);
    expect(avatar.identity.agePresentation).toBe('adult age range');
    expect(isMinorIdentity({...avatar,identity:revised})).toBe(true);
  });

  it('creates a minor lock by preserving prior physical evidence and removing adult-age classification',()=>{
    const avatar=adultAvatar();
    expect(currentIdentityLock(avatar)?.id).toBe('lock-v1');
    const revised=buildMinorIdentityLockRevision(avatar);
    expect(revised.permanent.subjectAgeClass).toBe('MINOR');
    expect(revised.permanent.ageHandling).toBe('PRESERVE_SOURCE_SUPPORTED_APPARENT_AGE');
    expect(revised.permanent.adultAgeRange).toBeUndefined();
    expect(revised.permanent.facialStructure).toBe('preserve');
    expect(revised.permanent.nose).toBe('preserve');
    expect(revised.permanent.jaw).toBe('preserve');
    expect(revised.temporary.wardrobe).toBe('exclude');
    expect(revised.uncertain.eyeColor).toBe('source unclear');
    expect(avatar.identityLocks[0].permanentAttributes.adultAgeRange).toBe('adult');
  });
});