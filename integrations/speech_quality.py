"""Small deterministic evaluation helpers, never a replacement for listening review."""
import re


def word_error_rate(reference, hypothesis):
    words=lambda s:re.findall(r'[^\W_]+',s.casefold(),flags=re.UNICODE)
    a,b=words(reference),words(hypothesis)
    if not a:
        raise ValueError('A nonempty reference is required')
    if len(a)>512 or len(b)>512:
        raise ValueError('Quality sample exceeds word limit')
    previous=list(range(len(b)+1))
    for i,word in enumerate(a,1):
        current=[i]
        for j,other in enumerate(b,1):
            current.append(min(previous[j]+1,current[j-1]+1,previous[j-1]+(word!=other)))
        previous=current
    return previous[-1]/len(a)


def quality_status(report):
    """No amount of numeric or synthetic-only results can approve voice identity."""
    required=('naturalness','speakerSimilarity','pronunciation','emotion','intelligibility')
    if not all(report.get('humanReview',{}).get(key)=='passed' for key in required):
        return 'pending-quality-review'
    if not report.get('spontaneousSpeechValidated') or not report.get('hardwareProfileValidated'):
        return 'pending-quality-review'
    if any(sample.get('reachedTokenCap') or sample.get('peak',0)>1 for sample in report.get('samples',[])):
        return 'failed'
    return 'review-complete'
