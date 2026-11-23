import json
import tempfile
import unittest
from pathlib import Path
from integrations.voice_runtime.profile_settings import merge_local_settings


class VoiceProfileSettingsTests(unittest.TestCase):
    def test_only_private_dataset_and_profile_can_override_release_defaults(self):
        parent=Path('.runtime/voice-library-tests')
        parent.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as temporary:
            root=Path(temporary)
            (root/'config').mkdir()
            identifier='11111111-1111-1111-1111-111111111111'
            base=dict(schemaVersion=1,profileDir='data/voices/capri/en/exports/capri-en-v1',port=8101)
            profile='data/voices/capri/en/exports/capri-trained-'+identifier
            file=root/'config/companion-voice.local.json'
            file.write_text(json.dumps(dict(schemaVersion=1,profileDir=profile)))
            self.assertEqual(merge_local_settings(root,'companion-voice',base),{**base,'profileDir':profile})
            self.assertEqual(base['profileDir'],'data/voices/capri/en/exports/capri-en-v1')
            file.write_text(json.dumps(dict(schemaVersion=1,profileDir=profile,port=9999)))
            with self.assertRaisesRegex(ValueError,'Invalid local'):
                merge_local_settings(root,'companion-voice',base)
            file=root/'config/voice-training.local.json'
            file.write_text(json.dumps(dict(schemaVersion=1,datasetDir='data/voices/capri/en/imports/'+identifier)))
            effective=merge_local_settings(root,'voice-training',dict(allowProvisionalTranscripts=True))
            self.assertFalse(effective['allowProvisionalTranscripts'])
            file.write_text(json.dumps(dict(schemaVersion=1,datasetDir='../outside')))
            with self.assertRaisesRegex(ValueError,'Invalid local'):
                merge_local_settings(root,'voice-training',{})


if __name__=='__main__':
    unittest.main()
