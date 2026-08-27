from fise.profile_runtime import Profile

_U=4294967295

def _m(b,q):
 a,c,d,e=3876253945,3056102676,388939340,1330607213
 for i,x in enumerate(b):
  a=((a^(x+i))*2728948653)&_U
  c=((c+x+(a>>16))*1803928921)&_U
  y=(d^x^c)&_U
  d=((y<<24)|(y>>8))&_U
  e=((e+d+i)*205131323)&_U
 return a,c,d,e

def _o(i,c,s,q):
 f=1728631386
 for n,v in enumerate(s):f=((f^v^n)*0x45d9f3b)&_U
 x=((i.transformed_length^1728631386)+(i.operation_binding_length*1976857766)+(c[0]^563523077)+(c[2]*292429670)+f)&_U
 x^=x>>16
 x=(x*0x7feb352d)&_U
 x^=x>>15
 x=(x*0x846ca68b)&_U
 return (x^(x>>16))%(i.transformed_length+1)

def _k(i,c,s,q):
 x=((i.transformed_length^610475904)+(i.operation_binding_length*4046335117)+(c[1]^562926487)+(c[3]*1122418575)+len(s))&_U
 for n,v in enumerate(s):x=((x^v^n)*0x1000193)&_U
 x^=x>>16
 x=(x*0x7feb352d)&_U
 x^=x>>15
 x=(x*0x846ca68b)&_U
 return (x^(x>>16))&_U

def _f(b,s,c,z,q):
 o=bytearray(len(b))
 for i,v in enumerate(b):
  p=(z+i)&_U
  x=v
  w=((p^c[2])*3858012775+c[2]+1450595981)&_U
  k=(s[(p+18)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  r=(k&7)+1
  x=((x<<r)|(x>>(8-r)))&255
  w=((p^c[3])*617950251+c[2]+3693548952)&_U
  k=(s[(p+19)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x^=k
  w=((p^c[0])*4064308501+c[3]+2017255422)&_U
  k=(s[(p+5)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  r=(k&7)+1
  x=((x<<r)|(x>>(8-r)))&255
  w=((p^c[0])*3278754351+c[1]+308500292)&_U
  k=(s[(p+0)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x=(x*171+k)&255
  w=((p^c[0])*1977465971+c[3]+1236245339)&_U
  k=(s[(p+7)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x^=k
  w=((p^c[3])*410574175+c[3]+1360650183)&_U
  k=(s[(p+6)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x=(x+k)&255
  w=((p^c[1])*1582840489+c[2]+1933943429)&_U
  k=(s[(p+17)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  r=(k&7)+1
  x=((x<<r)|(x>>(8-r)))&255
  o[i]=x
 return bytes(o)

def _r(b,s,c,z,q):
 o=bytearray(len(b))
 for i,v in enumerate(b):
  p=(z+i)&_U
  x=v
  w=((p^c[1])*1582840489+c[2]+1933943429)&_U
  k=(s[(p+17)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  r=(k&7)+1
  x=((x>>r)|(x<<(8-r)))&255
  w=((p^c[3])*410574175+c[3]+1360650183)&_U
  k=(s[(p+6)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x=(x-k)&255
  w=((p^c[0])*1977465971+c[3]+1236245339)&_U
  k=(s[(p+7)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x^=k
  w=((p^c[0])*3278754351+c[1]+308500292)&_U
  k=(s[(p+0)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x=((x-k)*3)&255
  w=((p^c[0])*4064308501+c[3]+2017255422)&_U
  k=(s[(p+5)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  r=(k&7)+1
  x=((x>>r)|(x<<(8-r)))&255
  w=((p^c[3])*617950251+c[2]+3693548952)&_U
  k=(s[(p+19)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  x^=k
  w=((p^c[2])*3858012775+c[2]+1450595981)&_U
  k=(s[(p+18)%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255
  r=(k&7)+1
  x=((x>>r)|(x<<(8-r)))&255
  o[i]=x
 return bytes(o)

profile=Profile.generated("fad10ce453c6c23734ea39a3e8770514",2673012437,20,_m,_o,_k,_f,_r)
__all__=("profile",)
