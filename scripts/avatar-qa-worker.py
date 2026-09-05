import base64,json,os,sys,cv2,numpy as np
ROOT=os.environ.get('AVATAR_QA_MODEL_ROOT','')
sys.path.insert(0,ROOT)
from mp_persondet import MPPersonDet
from mp_pose import MPPose
detector=cv2.FaceDetectorYN.create(os.path.join(ROOT,'face_detection_yunet_2023mar.onnx'),'',(320,320),0.85,0.3,5000)
recognizer=cv2.FaceRecognizerSF.create(os.path.join(ROOT,'face_recognition_sface_2021dec.onnx'),'')
person_detector=MPPersonDet(os.path.join(ROOT,'person_detection_mediapipe_2023mar.onnx'),scoreThreshold=.5)
pose_detector=MPPose(os.path.join(ROOT,'pose_estimation_mediapipe_2023mar.onnx'),confThreshold=.5)
JOINTS=['nose','leftEyeInner','leftEye','leftEyeOuter','rightEyeInner','rightEye','rightEyeOuter','leftEar','rightEar','mouthLeft','mouthRight','leftShoulder','rightShoulder','leftElbow','rightElbow','leftWrist','rightWrist','leftPinky','rightPinky','leftIndex','rightIndex','leftThumb','rightThumb','leftHip','rightHip','leftKnee','rightKnee','leftAnkle','rightAnkle','leftHeel','rightHeel','leftFootIndex','rightFootIndex']
def face(value):
  image=cv2.imdecode(np.frombuffer(base64.b64decode(value),np.uint8),cv2.IMREAD_COLOR)
  if image is None:return {'status':'DECODE_FAILED'}
  detector.setInputSize((image.shape[1],image.shape[0]));_,faces=detector.detect(image)
  if faces is None or len(faces)==0:return {'status':'NO_FACE','faceCount':0,'width':image.shape[1],'height':image.shape[0]}
  detected=list(faces); confident=[item for item in detected if item[-1]>=0.85]
  usable=[item for item in confident if item[2]>=32 and item[3]>=32]
  if len(usable)>1:return {'status':'MULTIPLE_FACES','faceCount':len(usable),'width':image.shape[1],'height':image.shape[0]}
  if len(confident)==0:return {'status':'FACE_LOW_CONFIDENCE','faceCount':len(detected),'width':image.shape[1],'height':image.shape[0],'confidence':float(max(item[-1] for item in detected))}
  if len(usable)==0:return {'status':'FACE_TOO_SMALL','faceCount':len(confident),'width':image.shape[1],'height':image.shape[0],'confidence':float(max(item[-1] for item in confident))}
  item=usable[0];aligned=recognizer.alignCrop(image,item);feature=recognizer.feature(aligned)
  box=[float(x) for x in item[:4]];landmarks=[float(x) for x in item[4:14]]
  return {'status':'ONE_USABLE_FACE','faceCount':1,'feature':feature,'box':box,'landmarks':landmarks,'confidence':float(item[-1]),'width':image.shape[1],'height':image.shape[0]}
def diagnose(req):
  image=cv2.imdecode(np.frombuffer(base64.b64decode(req['candidate']),np.uint8),cv2.IMREAD_COLOR)
  if image is None:return {'status':'DECODE_FAILED','faces':[],'persons':[]}
  height,width=image.shape[:2];detector.setInputSize((width,height));_,detected=detector.detect(image)
  usable=[]
  for index,item in enumerate(list(detected) if detected is not None else []):
    if item[-1]<0.85 or item[2]<32 or item[3]<32:continue
    aligned=recognizer.alignCrop(image,item);feature=recognizer.feature(aligned);observations=[]
    for source in req.get('sources',[]):
      source_face=face(source['bytes']);row={'sourceHash':source['contentHash'],'sourceStatus':source_face['status']}
      if source_face['status']=='ONE_USABLE_FACE':row['cosine']=float(recognizer.match(feature,source_face['feature'],cv2.FaceRecognizerSF_FR_COSINE))
      observations.append(row)
    box=[float(x) for x in item[:4]];usable.append({'faceIndex':len(usable),'detectorIndex':index,'box':box,'landmarks':[float(x) for x in item[4:14]],'confidence':float(item[-1]),'width':width,'height':height,'area':float(box[2]*box[3]),'areaRatio':float((box[2]*box[3])/(width*height)),'center':{'x':float((box[0]+box[2]/2)/width),'y':float((box[1]+box[3]/2)/height)},'observations':observations})
  persons=[]
  for person_index,person in enumerate(person_detector.infer(image)):
    result=pose_detector.infer(image,person)
    if result is None:persons.append({'personIndex':person_index,'status':'POSE_LOW_CONFIDENCE','association':'ASSOCIATION_UNCERTAIN','associatedFaceIndices':[]});continue
    bbox,landmarks,world,mask,heatmap,confidence=result;joints={}
    for index,name in enumerate(JOINTS):
      point_value=landmarks[index];world_point=world[index];joints[name]={'x':float(point_value[0]/width),'y':float(point_value[1]/height),'z':float(point_value[2]/max(image.shape[:2])),'visibility':float(point_value[3]),'presence':float(point_value[4]),'world':[float(world_point[0]),float(world_point[1]),float(world_point[2])],'sourceLandmarkIndex':index,'sourceModel':'pose_estimation_mediapipe_2023mar'}
    pixel_box=[float(bbox[0][0]),float(bbox[0][1]),float(bbox[1][0]),float(bbox[1][1])];normalized_box=[pixel_box[0]/width,pixel_box[1]/height,pixel_box[2]/width,pixel_box[3]/height];nose=joints['nose'];associated=[]
    for face_item in usable:
      fx,fy,fw,fh=face_item['box'];cx,cy=fx+fw/2,fy+fh/2;inside=pixel_box[0]<=cx<=pixel_box[2] and pixel_box[1]<=cy<=pixel_box[3];distance=float(np.hypot(nose['x']*width-cx,nose['y']*height-cy));near=distance<=max(fw,fh)
      if inside and near:associated.append(face_item['faceIndex']);face_item.setdefault('associations',[]).append({'personIndex':person_index,'insidePersonRoi':inside,'noseDistancePixels':distance,'noseDistanceFaceHeights':distance/max(fh,1),'confidence':float(min(confidence,nose['visibility'],nose['presence'])),'status':'ASSOCIATED'})
    required=['nose','leftShoulder','rightShoulder'];pose_usable=all(joints[name]['visibility']>=.5 and joints[name]['presence']>=.5 for name in required)
    persons.append({'personIndex':person_index,'status':'POSE_USABLE' if pose_usable else 'POSE_NOT_USABLE','association':'ASSOCIATED' if len(associated)==1 else 'ASSOCIATION_UNCERTAIN','associatedFaceIndices':associated,'confidence':float(confidence),'personBox':normalized_box,'personBoxPixels':pixel_box,'joints':joints,'maskCoverage':float(np.count_nonzero(mask)/mask.size)})
  for face_item in usable:face_item.setdefault('associations',[])
  return {'status':'ONE_USABLE_FACE' if len(usable)==1 else 'MULTIPLE_FACES' if len(usable)>1 else 'NO_FACE','faceCount':len(usable),'personCount':len(persons),'width':width,'height':height,'faces':usable,'persons':persons,'embeddingsPersisted':False}
def pose(value):
  image=cv2.imdecode(np.frombuffer(base64.b64decode(value),np.uint8),cv2.IMREAD_COLOR)
  if image is None:return {'status':'POSE_NOT_FOUND','association':'ASSOCIATION_UNCERTAIN'}
  people=person_detector.infer(image)
  if len(people)==0:return {'status':'NO_PERSON','association':'ASSOCIATION_UNCERTAIN'}
  if len(people)>1:return {'status':'MULTIPLE_PERSONS','association':'ASSOCIATION_UNCERTAIN','personCount':int(len(people))}
  result=pose_detector.infer(image,people[0])
  if result is None:return {'status':'POSE_LOW_CONFIDENCE','association':'ASSOCIATION_UNCERTAIN','personCount':1}
  bbox,landmarks,world,mask,heatmap,confidence=result
  joints={}
  for index,name in enumerate(JOINTS):
    point=landmarks[index];world_point=world[index]
    joints[name]={'x':float(point[0]/image.shape[1]),'y':float(point[1]/image.shape[0]),'z':float(point[2]/max(image.shape[:2])),'visibility':float(point[3]),'presence':float(point[4]),'world':[float(world_point[0]),float(world_point[1]),float(world_point[2])],'sourceLandmarkIndex':index,'sourceModel':'pose_estimation_mediapipe_2023mar'}
  required=['nose','leftShoulder','rightShoulder'];usable=all(joints[name]['visibility']>=.5 and joints[name]['presence']>=.5 for name in required)
  candidate_face=face(value);association='ASSOCIATION_UNCERTAIN'
  if candidate_face['status']=='ONE_USABLE_FACE':
    fx,fy,fw,fh=candidate_face['box'];px1,py1=bbox[0];px2,py2=bbox[1];nose=joints['nose'];inside=px1<=fx+fw/2<=px2 and py1<=fy+fh/2<=py2
    near=np.hypot(nose['x']*image.shape[1]-(fx+fw/2),nose['y']*image.shape[0]-(fy+fh/2))<=max(fw,fh)
    association='ASSOCIATED' if inside and near else 'ASSOCIATION_UNCERTAIN'
  face_geometry=None
  if candidate_face['status']=='ONE_USABLE_FACE':face_geometry={'box':candidate_face['box'],'landmarks':candidate_face['landmarks'],'width':candidate_face['width'],'height':candidate_face['height'],'confidence':candidate_face['confidence']}
  return {'status':'POSE_USABLE' if usable and association=='ASSOCIATED' else 'POSE_PARTIAL' if usable else 'POSE_NOT_USABLE','association':association,'personCount':1,'confidence':float(confidence),'personBox':[float(bbox[0][0]/image.shape[1]),float(bbox[0][1]/image.shape[0]),float(bbox[1][0]/image.shape[1]),float(bbox[1][1]/image.shape[0])],'joints':joints,'maskCoverage':float(np.count_nonzero(mask)/mask.size),'faceGeometry':face_geometry}
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
def scan(req):
  items=[]
  for source in req['sources']:
    detected=face(source['bytes']);items.append({'intakeId':source['intakeId'],'contentHash':source['contentHash'],'status':detected['status'],'faceCount':detected.get('faceCount'),'box':detected.get('box'),'landmarks':detected.get('landmarks'),'width':detected.get('width'),'height':detected.get('height'),'confidence':detected.get('confidence'),'feature':detected.get('feature')})
  pairs=[]
  for left in range(len(items)):
    for right in range(left+1,len(items)):
      if items[left]['status']=='ONE_USABLE_FACE' and items[right]['status']=='ONE_USABLE_FACE':pairs.append({'left':items[left]['contentHash'],'right':items[right]['contentHash'],'cosine':float(recognizer.match(items[left]['feature'],items[right]['feature'],cv2.FaceRecognizerSF_FR_COSINE))})
  for item in items:item.pop('feature',None)
  return {'items':items,'pairs':pairs}
def video(req):
  sources=[face(source['bytes']) for source in req['sources']]
  frames=[];previous=None
  for frame in req['frames']:
    detected=face(frame['bytes']);row={'frameIndex':frame['frameIndex'],'candidateStatus':detected['status'],'geometry':{'box':detected.get('box'),'landmarks':detected.get('landmarks'),'width':detected.get('width'),'height':detected.get('height')},'observations':[]}
    if detected['status']=='ONE_USABLE_FACE':
      for index,source in enumerate(sources):
        source_hash=req['sources'][index]['contentHash'];observation={'sourceHash':source_hash,'sourceStatus':source['status']}
        if source['status']=='ONE_USABLE_FACE':observation['cosine']=float(recognizer.match(detected['feature'],source['feature'],cv2.FaceRecognizerSF_FR_COSINE))
        row['observations'].append(observation)
      if previous is not None:row['adjacentCosine']=float(recognizer.match(previous,detected['feature'],cv2.FaceRecognizerSF_FR_COSINE))
      previous=detected['feature']
    else:previous=None
    frames.append(row)
  return {'frames':frames}
def skeleton(req):
  return pose(req['image'])

for line in sys.stdin:
  try:
    req=json.loads(line);operation=req.get('operation');result=diagnose(req) if operation=='diagnose' else scan(req) if operation=='scan' else video(req) if operation=='video' else skeleton(req) if operation=='skeleton' else evaluate(req);print(json.dumps({'id':req['id'],'ok':True,'result':result}),flush=True)
  except Exception as error:print(json.dumps({'id':req.get('id'),'ok':False,'error':'LOCAL_EVALUATOR_ERROR'}),flush=True)
