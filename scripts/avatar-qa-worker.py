import base64,json,os,sys,cv2,numpy as np
ROOT=os.environ.get('AVATAR_QA_MODEL_ROOT','')
detector=cv2.FaceDetectorYN.create(os.path.join(ROOT,'face_detection_yunet_2023mar.onnx'),'',(320,320),0.85,0.3,5000)
recognizer=cv2.FaceRecognizerSF.create(os.path.join(ROOT,'face_recognition_sface_2021dec.onnx'),'')
def face(value):
  image=cv2.imdecode(np.frombuffer(base64.b64decode(value),np.uint8),cv2.IMREAD_COLOR)
  if image is None:return {'status':'NO_USABLE_FACE'}
  detector.setInputSize((image.shape[1],image.shape[0]));_,faces=detector.detect(image)
  if faces is None or len(faces)==0:return {'status':'NO_USABLE_FACE'}
  usable=[item for item in faces if item[-1]>=0.85 and item[2]>=32 and item[3]>=32]
  if len(usable)!=1:return {'status':'MULTIPLE_FACES' if len(usable)>1 else 'FACE_TOO_SMALL'}
  item=usable[0];aligned=recognizer.alignCrop(image,item);feature=recognizer.feature(aligned)
  box=[float(x) for x in item[:4]];landmarks=[float(x) for x in item[4:14]]
  return {'status':'ONE_USABLE_FACE','feature':feature,'box':box,'landmarks':landmarks,'width':image.shape[1],'height':image.shape[0]}
def evaluate(req):
  candidate=face(req['candidate']);out={'candidateStatus':candidate['status'],'observations':[]}
  if candidate['status']!='ONE_USABLE_FACE':return out
  out['candidateGeometry']={'box':candidate['box'],'landmarks':candidate['landmarks'],'width':candidate['width'],'height':candidate['height']}
  for source in req['sources']:
    item=face(source['bytes']);row={'sourceHash':source['contentHash'],'sourceStatus':item['status']}
    if item['status']=='ONE_USABLE_FACE':
      row['cosine']=float(recognizer.match(candidate['feature'],item['feature'],cv2.FaceRecognizerSF_FR_COSINE));row['sourceGeometry']={'box':item['box'],'landmarks':item['landmarks'],'width':item['width'],'height':item['height']}
    out['observations'].append(row)
  return out
for line in sys.stdin:
  try:
    req=json.loads(line);print(json.dumps({'id':req['id'],'ok':True,'result':evaluate(req)}),flush=True)
  except Exception as error:print(json.dumps({'id':req.get('id'),'ok':False,'error':'LOCAL_EVALUATOR_ERROR'}),flush=True)
