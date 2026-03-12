const bcrypt = require('bcrypt');

async function hashPassword(password) {
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(password, saltRounds);
  console.log('Yeni hashlenmiş şifre:', hashedPassword);
  return hashedPassword;
}

// "cesme123" için yeni bir hash oluşturalım
hashPassword('cesme123').then(hash => {
  console.log('Şifreyi güncellemek için SQL komutu:');
  console.log(`UPDATE users SET password = '${hash}' WHERE username = 'cesmesuperadmin';`);
});