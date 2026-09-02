import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IdentityCoverage, identityCoverage } from '../src/IdentitySourceTools';

function source(id,viewpoint) {
  return { id,sourceType:'IMAGE',gate0Status:'PASS',provenance:{identityViewpoint:viewpoint} };
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
});
